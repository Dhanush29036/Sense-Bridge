"""
Flask Integration Layer — Main Application
==========================================
Exposes all AI modules as REST endpoints for the React/Capacitor frontend.

Architecture:
    POST /api/detect          ← Send base64 or multipart frame → get detections
    POST /api/ocr             ← Send frame → get text regions
    POST /api/stt/transcribe  ← Send WAV bytes → get transcript
    POST /api/gesture/predict ← Send landmark sequence → get gesture label
    GET  /health              ← Health check

Deployment options:
    1. On-device via Termux (Android):
         gunicorn api.app:app -b 0.0.0.0:8000 -w 1 --threads 2
    2. Remote server (fallback when offline unavailable):
         gunicorn api.app:app -b 0.0.0.0:8000 -w 2

Usage:
    python -m api.app
"""

import os
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from api.routes.detection import detection_bp
from api.routes.ocr       import ocr_bp
from api.routes.stt       import stt_bp
from api.routes.gesture   import gesture_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024   # 10 MB upload limit

    # ─── CORS ─────────────────────────────────────────────────────────────────
    CORS(app, resources={
        r"/api/*": {
            "origins": [
                "http://localhost:5173",
                "http://localhost:3000",
                "capacitor://localhost",
                "http://localhost",
            ]
        }
    })

    # ─── Rate limiting ────────────────────────────────────────────────────────
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["200 per minute"],
        storage_uri="memory://",
    )
    limiter.limit("60/minute")(detection_bp)

    # ─── Blueprints ───────────────────────────────────────────────────────────
    app.register_blueprint(detection_bp, url_prefix="/api")
    app.register_blueprint(ocr_bp,       url_prefix="/api")
    app.register_blueprint(stt_bp,       url_prefix="/api")
    app.register_blueprint(gesture_bp,   url_prefix="/api")

    # ─── Health check ─────────────────────────────────────────────────────────
    @app.get("/health")
    def health():
        return jsonify({
            "status": "ok",
            "service": "SenseBridge AI",
            "timestamp": time.time(),
        })

    # ─── Global error handlers ────────────────────────────────────────────────
    @app.errorhandler(413)
    def too_large(e):
        return jsonify({"success": False, "message": "Upload too large (max 10MB)"}), 413

    @app.errorhandler(429)
    def rate_limited(e):
        return jsonify({"success": False, "message": "Rate limit exceeded"}), 429

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"success": False, "message": "Internal server error"}), 500

    return app


app = create_app()

if __name__ == "__main__":
    host  = os.getenv("FLASK_HOST", "0.0.0.0")
    port  = int(os.getenv("FLASK_PORT", "8000"))
    debug = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    print(f"🚀  SenseBridge AI server on {host}:{port}")
    app.run(host=host, port=port, debug=debug, threaded=True)
