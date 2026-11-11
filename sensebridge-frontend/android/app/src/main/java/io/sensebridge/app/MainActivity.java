package io.sensebridge.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private SpeechRecognizer speechRecognizer;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Request runtime permissions for Audio, Camera, and GPS
        requestAppPermissions();

        // 2. Initialize native Text-to-Speech
        try {
            tts = new TextToSpeech(getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    tts.setLanguage(Locale.US);
                    tts.setPitch(1.0f);
                    tts.setSpeechRate(1.0f);
                    ttsReady = true;
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 3. Configure WebView audio settings and register JavaScript interfaces
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
                webView.addJavascriptInterface(new NativeTTSInterface(), "AndroidTTS");
                webView.addJavascriptInterface(new NativeSTTInterface(), "AndroidSTT");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void requestAppPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] permissions = {
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            };
            List<String> needed = new ArrayList<>();
            for (String p : permissions) {
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(p);
                }
            }
            if (!needed.isEmpty()) {
                ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), 101);
            }
        }
    }

    public class NativeTTSInterface {
        @JavascriptInterface
        public boolean speak(String text) {
            if (ttsReady && tts != null && text != null && !text.trim().isEmpty()) {
                try {
                    tts.stop();
                    Bundle params = new Bundle();
                    params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
                    int res = tts.speak(text.trim(), TextToSpeech.QUEUE_FLUSH, params, "sb_tts_" + System.currentTimeMillis());
                    return res == TextToSpeech.SUCCESS;
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
            return false;
        }

        @JavascriptInterface
        public void stop() {
            if (tts != null) {
                try { tts.stop(); } catch (Exception ignored) {}
            }
        }

        @JavascriptInterface
        public boolean isReady() {
            return ttsReady && tts != null;
        }
    }

    public class NativeSTTInterface {
        @JavascriptInterface
        public void startListening(String lang) {
            runOnUiThread(() -> {
                try {
                    if (speechRecognizer == null) {
                        initSpeechRecognizer();
                    }
                    if (speechRecognizer != null) {
                        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                        if (lang != null && !lang.isEmpty() && !lang.equals("auto")) {
                            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                        }
                        speechRecognizer.startListening(intent);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(() -> {
                try {
                    if (speechRecognizer != null) {
                        speechRecognizer.stopListening();
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
        }

        @JavascriptInterface
        public boolean isAvailable() {
            return SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
        }
    }

    private void initSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                sendJsEvent("onSpeechReady", "{}");
            }

            @Override
            public void onBeginningOfSpeech() {
                sendJsEvent("onSpeechStart", "{}");
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                sendJsEvent("onSpeechRms", String.valueOf(rmsdB));
            }

            @Override
            public void onBufferReceived(byte[] buffer) {}

            @Override
            public void onEndOfSpeech() {
                sendJsEvent("onSpeechEnd", "{}");
            }

            @Override
            public void onError(int error) {
                sendJsEvent("onSpeechError", String.valueOf(error));
                // Automatically restart listening if continuous mode is active
                runOnUiThread(() -> {
                    try {
                        if (speechRecognizer != null) {
                            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                            speechRecognizer.startListening(intent);
                        }
                    } catch (Exception ignored) {}
                });
            }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    String recognized = matches.get(0).replace("\"", "\\\"").replace("\n", " ");
                    sendJsEvent("onSpeechResult", "{ \"text\": \"" + recognized + "\", \"isFinal\": true }");
                }
                // Automatically restart listening for continuous recognition
                runOnUiThread(() -> {
                    try {
                        if (speechRecognizer != null) {
                            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                            speechRecognizer.startListening(intent);
                        }
                    } catch (Exception ignored) {}
                });
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    String recognized = matches.get(0).replace("\"", "\\\"").replace("\n", " ");
                    sendJsEvent("onSpeechResult", "{ \"text\": \"" + recognized + "\", \"isFinal\": false }");
                }
            }

            @Override
            public void onEvent(int eventType, Bundle params) {}
        });
    }

    private void sendJsEvent(String funcName, String jsonPayload) {
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window." + funcName + " && window." + funcName + "(" + jsonPayload + ");",
                        null
                    );
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    @Override
    public void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        super.onDestroy();
    }
}
