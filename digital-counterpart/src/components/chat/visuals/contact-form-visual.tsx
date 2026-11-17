"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Loader2,
  Mail,
  RotateCcw,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ContactFormVisualData } from "@/lib/chat/visual-types";
import { emailDraftUrl } from "@/lib/contact/email-draft";
import { contactMessageSchema } from "@/lib/contact/schema";
import { EASE_OUT_EXPO } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import { CardFrame } from "./card-frame";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; message: string }
  | { state: "error"; message: string; fallbackEmail?: string; retryable?: boolean };

type Fields = {
  name: string;
  email: string;
  company: string;
  reason: string;
  message: string;
  /** Honeypot. Must stay empty. */
  website: string;
};

type FieldName = keyof Fields;
type FieldErrors = Partial<Record<FieldName | "form", string>>;

const EMPTY: Fields = {
  name: "",
  email: "",
  company: "",
  reason: "",
  message: "",
  website: "",
};

const REQUEST_TIMEOUT_MS = 13_000;

/**
 * Sending Gaurav a message, inside the conversation.
 *
 * This deliberately never calls the model: opening a form is an interface
 * action, not a question. It also never shows a success state for a message
 * that did not reach a delivery adapter. When delivery is unavailable, the
 * same fields build a draft in the visitor's email app.
 */
export function ContactFormVisual({ data }: { data: ContactFormVisualData }) {
  const [fields, setFields] = React.useState<Fields>(EMPTY);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [status, setStatus] = React.useState<Status>({ state: "idle" });
  const formRef = React.useRef<HTMLFormElement>(null);
  const successRef = React.useRef<HTMLDivElement>(null);
  const controlsRef = React.useRef<Partial<Record<FieldName, HTMLElement>>>({});
  const submissionKeyRef = React.useRef<string | null>(null);
  const sendingRef = React.useRef(false);
  const id = React.useId();
  const reduced = useReducedMotion();

  React.useEffect(() => {
    if (status.state === "sent") successRef.current?.focus();
  }, [status.state]);

  const set = <K extends FieldName>(key: K, value: Fields[K]) => {
    setFields((current) => ({ ...current, [key]: value }));
    submissionKeyRef.current = null;

    setErrors((current) => {
      if (!current[key] && !current.form) return current;
      const next = { ...current };
      delete next[key];
      delete next.form;
      return next;
    });

    if (status.state === "error") setStatus({ state: "idle" });
  };

  const focusFirstError = (nextErrors: FieldErrors) => {
    const first = (["name", "email", "company", "reason", "message"] as const).find(
      (field) => nextErrors[field],
    );
    if (first) requestAnimationFrame(() => controlsRef.current[first]?.focus());
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sendingRef.current) return;

    const payload = { ...fields, reason: fields.reason || undefined };
    const parsed = contactMessageSchema.safeParse(payload);

    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form") as keyof FieldErrors;
        nextErrors[field] ??= issue.message;
      }
      setErrors(nextErrors);
      setStatus({ state: "error", message: "Have a look at the highlighted fields." });
      focusFirstError(nextErrors);
      return;
    }

    if (!data.deliveryConfigured) {
      window.location.assign(emailDraftUrl(data.email, parsed.data));
      return;
    }

    sendingRef.current = true;
    setStatus({ state: "sending" });
    setErrors({});

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const submissionKey = submissionKeyRef.current ?? createSubmissionKey();
    submissionKeyRef.current = submissionKey;

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": submissionKey,
        },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => null)) as
        | {
            ok: boolean;
            message: string;
            errors?: FieldErrors;
            fallbackEmail?: string;
          }
        | null;

      if (!body || typeof body.ok !== "boolean" || typeof body.message !== "string") {
        throw new Error("invalid response");
      }

      if (body.ok) {
        submissionKeyRef.current = null;
        setStatus({ state: "sent", message: body.message });
        return;
      }

      if (body.errors) {
        setErrors(body.errors);
        focusFirstError(body.errors);
      }
      setStatus({
        state: "error",
        message: body.message,
        fallbackEmail: body.fallbackEmail,
        retryable: response.status >= 500,
      });
    } catch (error) {
      setStatus({
        state: "error",
        message:
          error instanceof DOMException && error.name === "AbortError"
            ? "The send is taking longer than expected. Retry safely, or use email directly."
            : "The connection dropped before delivery could be confirmed.",
        fallbackEmail: data.email,
        retryable: true,
      });
    } finally {
      window.clearTimeout(timeout);
      sendingRef.current = false;
    }
  };

  if (status.state === "sent") {
    return (
      <CardFrame label="Message sent" aside="Delivered">
        <motion.div
          ref={successRef}
          tabIndex={-1}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          className="flex items-start gap-3 outline-none"
        >
          <span className="bg-success/12 text-success flex size-9 shrink-0 items-center justify-center rounded-full">
            <Check className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium">{status.message}</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Your details reached {data.name}. A reply will go to the email address you provided.
            </p>
          </div>
        </motion.div>
      </CardFrame>
    );
  }

  const sending = status.state === "sending";
  const fieldId = (field: FieldName) => `${id}-${field}`;
  const describedBy = (field: FieldName) =>
    errors[field] ? `${fieldId(field)}-error` : undefined;

  return (
    <CardFrame
      label={`Message ${data.name}`}
      aside={data.deliveryConfigured ? "Direct to inbox" : "Email draft"}
    >
      <div className="mb-3 flex items-start gap-2.5">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
          <Mail className="size-3.5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium">Start the conversation.</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {data.deliveryConfigured
              ? `A short note is enough. It goes to ${data.name}, not a mailing list.`
              : "Write your note here, then review it in your email app before sending."}
          </p>
        </div>
      </div>

      <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3" noValidate aria-busy={sending}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field id={fieldId("name")} label="Name" required error={errors.name}>
            <input
              ref={(node) => {
                if (node) controlsRef.current.name = node;
              }}
              id={fieldId("name")}
              value={fields.name}
              onChange={(event) => set("name", event.target.value)}
              autoComplete="name"
              maxLength={data.limits.name}
              required
              disabled={sending}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy("name")}
              placeholder="Your name"
              className={inputClass(errors.name)}
            />
          </Field>

          <Field id={fieldId("email")} label="Email" required error={errors.email}>
            <input
              ref={(node) => {
                if (node) controlsRef.current.email = node;
              }}
              id={fieldId("email")}
              type="email"
              inputMode="email"
              value={fields.email}
              onChange={(event) => set("email", event.target.value)}
              autoComplete="email"
              maxLength={data.limits.email}
              required
              disabled={sending}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy("email")}
              placeholder="you@company.com"
              className={inputClass(errors.email)}
            />
          </Field>

          <Field id={fieldId("company")} label="Company" hint="Optional" error={errors.company}>
            <input
              ref={(node) => {
                if (node) controlsRef.current.company = node;
              }}
              id={fieldId("company")}
              value={fields.company}
              onChange={(event) => set("company", event.target.value)}
              autoComplete="organization"
              maxLength={data.limits.company}
              disabled={sending}
              aria-invalid={Boolean(errors.company)}
              aria-describedby={describedBy("company")}
              placeholder="Where you're writing from"
              className={inputClass(errors.company)}
            />
          </Field>

          <Field id={fieldId("reason")} label="Topic" hint="Optional" error={errors.reason}>
            <select
              ref={(node) => {
                if (node) controlsRef.current.reason = node;
              }}
              id={fieldId("reason")}
              value={fields.reason}
              onChange={(event) => set("reason", event.target.value)}
              disabled={sending}
              aria-invalid={Boolean(errors.reason)}
              aria-describedby={describedBy("reason")}
              className={cn(inputClass(errors.reason), "appearance-none")}
            >
              <option value="">Choose a topic…</option>
              {data.reasons.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          id={fieldId("message")}
          label="Message"
          required
          hint={`${fields.message.length} / ${data.limits.message}`}
          error={errors.message}
        >
          <textarea
            ref={(node) => {
              if (node) controlsRef.current.message = node;
            }}
            id={fieldId("message")}
            value={fields.message}
            onChange={(event) => set("message", event.target.value)}
            rows={4}
            minLength={10}
            maxLength={data.limits.message}
            required
            disabled={sending}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={describedBy("message")}
            placeholder="What's the opportunity, question, or idea?"
            className={cn(inputClass(errors.message), "min-h-28 resize-y leading-relaxed")}
          />
        </Field>

        {/* Honeypot: absent visually and from the accessibility tree, but still
            discoverable to bots that indiscriminately fill form controls. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor={fieldId("website")}>Website</label>
          <input
            id={fieldId("website")}
            tabIndex={-1}
            autoComplete="off"
            value={fields.website}
            onChange={(event) => set("website", event.target.value)}
          />
        </div>

        <AnimatePresence initial={false}>
          {status.state === "error" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: reduced ? 0 : 0.18 }}
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive overflow-hidden rounded-lg border"
            >
              <div className="flex items-start gap-2 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1 text-xs leading-relaxed">
                  <p>{status.message}</p>
                  {status.fallbackEmail && (
                    <a
                      href={mailto(status.fallbackEmail)}
                      className="mt-1 inline-flex items-center gap-1 font-medium underline underline-offset-2"
                    >
                      Email {status.fallbackEmail}
                      <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  )}
                </div>
                {status.retryable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => formRef.current?.requestSubmit()}
                    className="border-destructive/30 text-destructive hover:bg-destructive/10 -my-1 shrink-0"
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Retry
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          <a
            href={mailto(data.email)}
            className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
          >
            Prefer email? {data.email}
          </a>

          <Button type="submit" size="sm" disabled={sending} className="min-w-24">
            {sending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Sending…
              </>
            ) : (
              <>
                <Send className="size-3.5" aria-hidden />
                {data.deliveryConfigured ? "Send message" : "Open email draft"}
              </>
            )}
          </Button>
        </div>
      </form>
    </CardFrame>
  );
}

function Field({
  id,
  label,
  hint,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2">
        <span className="label-mark">
          {label}
          {required && <span className="text-primary ml-0.5" aria-hidden>*</span>}
        </span>
        {hint && <span className="text-muted-foreground text-[10px] tabular-nums">{hint}</span>}
      </label>
      {children}
      {error && (
        <span id={`${id}-error`} className="text-destructive text-[11px] leading-snug">
          {error}
        </span>
      )}
    </div>
  );
}

function inputClass(error?: string): string {
  return cn(
    "border-border bg-background/60 text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-2.5 py-2 text-base outline-none transition-[border-color,box-shadow] duration-150 md:text-sm",
    "focus:border-primary/60 focus:ring-ring/15 focus:ring-4 disabled:cursor-wait disabled:opacity-60",
    error && "border-destructive/60",
  );
}

function createSubmissionKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `contact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mailto(email: string): string {
  return `mailto:${email}?subject=${encodeURIComponent("Hello Gaurav — via GauravGPT")}`;
}
