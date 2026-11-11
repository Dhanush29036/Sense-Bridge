package io.sensebridge.app;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private TextToSpeech tts;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    tts.setLanguage(Locale.US);
                    tts.setPitch(1.0f);
                    tts.setSpeechRate(1.0f);
                }
            });

            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.addJavascriptInterface(new NativeTTSInterface(), "AndroidTTS");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public class NativeTTSInterface {
        @JavascriptInterface
        public void speak(String text) {
            if (tts != null && text != null && !text.trim().isEmpty()) {
                tts.stop();
                tts.speak(text.trim(), TextToSpeech.QUEUE_FLUSH, null, "sb_tts_" + System.currentTimeMillis());
            }
        }

        @JavascriptInterface
        public void stop() {
            if (tts != null) {
                tts.stop();
            }
        }

        @JavascriptInterface
        public boolean isReady() {
            return tts != null;
        }
    }

    @Override
    public void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }
}
