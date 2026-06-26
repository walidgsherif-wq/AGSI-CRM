'use client';

import { useState, type FormHTMLAttributes } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './button';
import { useUnsavedGuard } from '@/lib/hooks/use-unsaved-guard';

type GuardedFormProps = FormHTMLAttributes<HTMLFormElement>;

/**
 * Drop-in replacement for <form>. Tracks "dirty":
 *   - flipped to true on the first onInput event (any field changed)
 *   - reset to false the moment submit is invoked (saving is intentional exit)
 *
 * While dirty, useUnsavedGuard hooks beforeunload + a capture-phase
 * anchor-click listener. On an in-app navigation attempt, this
 * wrapper renders a shared Radix confirm dialog. On confirm the
 * destination is pushed via router.push; on cancel the user stays
 * on the form with input intact.
 *
 * Field state is untouched — consumers keep their existing useState /
 * defaultValue / FormData-from-event setup. The only thing the form
 * gets from us is an onInput listener (composed with any caller-
 * provided onInput) and a wrapper around the action / onSubmit.
 *
 * If the action fails and the user edits again, the next onInput
 * re-marks dirty automatically.
 */
export function GuardedForm({
  children,
  action,
  onInput: callerOnInput,
  onSubmit: callerOnSubmit,
  ...rest
}: GuardedFormProps) {
  const [dirty, setDirty] = useState(false);
  const { pendingHref, confirm, cancel } = useUnsavedGuard(dirty);

  function handleInput(e: React.FormEvent<HTMLFormElement>) {
    if (!dirty) setDirty(true);
    callerOnInput?.(e);
  }

  // Wrap the action so we clear dirty before submission begins.
  // Server-action `action` props can be a function or a string URL;
  // we only wrap the function form.
  const wrappedAction =
    typeof action === 'function'
      ? (formData: FormData) => {
          setDirty(false);
          return (action as (fd: FormData) => unknown)(formData);
        }
      : action;

  // Same idea for the onSubmit handler if the caller uses that instead.
  const wrappedOnSubmit = callerOnSubmit
    ? (e: React.FormEvent<HTMLFormElement>) => {
        setDirty(false);
        callerOnSubmit(e);
      }
    : undefined;

  return (
    <>
      <form
        {...rest}
        action={wrappedAction as GuardedFormProps['action']}
        onSubmit={wrappedOnSubmit}
        onInput={handleInput}
      >
        {children}
      </form>

      <Dialog.Root
        open={pendingHref !== null}
        onOpenChange={(next) => {
          if (!next) cancel();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-agsi-navy/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
            aria-describedby={undefined}
          >
            <div className="space-y-4 rounded-xl border border-agsi-lightGray bg-white p-5 shadow-xl">
              <Dialog.Title className="text-base font-semibold text-agsi-navy">
                You have unsaved changes
              </Dialog.Title>
              <p className="text-sm text-agsi-darkGray">
                Leave without saving? Your edits will be lost.
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancel}
                >
                  Stay on page
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={confirm}
                >
                  Leave without saving
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
