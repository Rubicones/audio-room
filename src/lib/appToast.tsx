import toast from "react-hot-toast";
import {
  AppToastMessage,
  type AppToastVariant,
} from "@/components/ui/AppToastMessage";

const DEFAULT_DURATION = 2600;
const ERROR_DURATION = 4000;

function showAppToast(message: string, variant: AppToastVariant) {
  const duration = variant === "error" ? ERROR_DURATION : DEFAULT_DURATION;
  return toast.custom(
    (toastState) => (
      <AppToastMessage toastState={toastState} message={message} variant={variant} />
    ),
    { duration },
  );
}

export const appToast = {
  success: (message: string) => showAppToast(message, "success"),
  error: (message: string) => showAppToast(message, "error"),
  info: (message: string) => showAppToast(message, "info"),
  warning: (message: string) => showAppToast(message, "warning"),
};
