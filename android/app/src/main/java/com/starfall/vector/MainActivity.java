package com.starfall.vector;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Game host activity.
 *
 * A shooter needs the whole screen and must not dim or lock mid-run, so this
 * goes edge-to-edge immersive and holds a keep-screen-on flag for the lifetime
 * of the activity. System bars are re-hidden whenever the user swipes them back
 * in (STICKY_IMMERSIVE only lasts until the next gesture).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        hideSystemUi();

        // Re-assert immersive mode when the bars reappear.
        getWindow()
                .getDecorView()
                .setOnSystemUiVisibilityChangeListener(
                        visibility -> {
                            if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                                getWindow()
                                        .getDecorView()
                                        .postDelayed(this::hideSystemUi, 400);
                            }
                        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
        }
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
            getWindow()
                    .getInsetsController()
                    .hide(android.view.WindowInsets.Type.systemBars());
            getWindow()
                    .getInsetsController()
                    .setSystemBarsBehavior(
                            android.view.WindowInsetsController
                                    .BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }
}
