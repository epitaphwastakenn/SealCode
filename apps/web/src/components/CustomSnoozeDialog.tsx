import { lazy, Suspense, useEffect } from "react";
import { create } from "zustand";
import type { SnoozeChoice } from "./CustomSnoozeDialogForm";

// The calendar and its date library load the first time a snooze is requested.
const CustomSnoozeDialogForm = lazy(() => import("./CustomSnoozeDialogForm"));

type Request = { readonly resolve: (choice: SnoozeChoice | null) => void };
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function requestCustomSnooze(): Promise<SnoozeChoice | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { resolve } }));
}

function finish(choice: SnoozeChoice | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(choice);
}

export function CustomSnoozeDialogHost() {
  const request = useRequest((state) => state.request);
  useEffect(() => () => finish(null), []);
  return request ? (
    <Suspense fallback={null}>
      <CustomSnoozeDialogForm finish={finish} />
    </Suspense>
  ) : null;
}
