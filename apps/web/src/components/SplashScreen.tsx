import { APP_DISPLAY_NAME } from "../branding";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={`${APP_DISPLAY_NAME} splash screen`}
      >
        <img alt={APP_DISPLAY_NAME} className="size-20 object-contain" src="/sealcode-icon.png" />
      </div>
    </div>
  );
}
