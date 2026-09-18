import { randomUUID, createHash } from "node:crypto";
import { CoordinationStore, type CoordinationLedger } from "./store.ts";
import type {
  SupportRequest,
  CreateRequestInput,
  ConsentInput,
  InquiryInput,
  Inquiry,
  CallAttempt,
  AttemptResult,
  AnswerInput,
  Need,
  CitizenProfile,
  RequestDetails,
} from "./types.ts";
export class CoordinationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(code);
    this.name = "CoordinationError";
  }
}
const fail = (code: string, status = 409): never => {
  throw new CoordinationError(code, status);
};
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 10000;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 100 && v.every(text);
const programs = ["foodbank-market", "mobile-market", "just-dream", "care-sos"];
const now = () => new Date().toISOString();
const boundedText = (value: unknown, maximum: number): value is string =>
  text(value) && value.length <= maximum;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validateCitizenProfile(value: unknown): CitizenProfile {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "name",
          "address",
          "age",
          "household",
          "mobility",
          "contactPreference",
        ].includes(key),
    ) ||
    !boundedText(value.name, 100) ||
    !boundedText(value.address, 500) ||
    (value.age !== undefined &&
      (typeof value.age !== "number" ||
        !Number.isInteger(value.age) ||
        value.age < 0 ||
        value.age > 130)) ||
    ["household", "mobility", "contactPreference"].some(
      (key) => value[key] !== undefined && !boundedText(value[key], 200),
    )
  )
    fail("INVALID_PROFILE", 400);
  return structuredClone(value) as unknown as CitizenProfile;
}
export function validateRequestDetails(value: unknown): RequestDetails {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !["quantity", "requestedDate", "deliveryMethod"].includes(key),
    ) ||
    Object.entries(value).some(
      ([key, entry]) =>
        !boundedText(entry, key === "requestedDate" ? 100 : 200),
    )
  )
    fail("INVALID_REQUEST_DETAILS", 400);
  return structuredClone(value) as RequestDetails;
}

function request(l: CoordinationLedger, id: string): SupportRequest {
  return l.requests[id] ?? fail("REQUEST_NOT_FOUND", 404);
}
function need(r: SupportRequest, id: string): Need {
  return r.needs.find((n) => n.id === id) ?? fail("NEED_NOT_FOUND", 404);
}
function inquiry(r: SupportRequest, id: string): Inquiry {
  return r.inquiries.find((q) => q.id === id) ?? fail("INQUIRY_NOT_FOUND", 404);
}
function event(
  l: CoordinationLedger,
  r: SupportRequest,
  type: string,
  detail: string,
): void {
  r.updatedAt = now();
  l.events.push({
    id: randomUUID(),
    requestId: r.id,
    type,
    at: r.updatedAt,
    detail,
    revision: r.revision,
  });
}
function liveNeed(r: SupportRequest, q: Inquiry): Need {
  const n = need(r, q.needId);
  if (n.status === "stopped") fail("NEED_STOPPED");
  return n;
}
export class CoordinationEngine {
  constructor(private readonly store: CoordinationStore) {}
  createRequest(input: CreateRequestInput): SupportRequest {
    if (input?.intakeKey !== undefined && (!text(input.intakeKey) || input.intakeKey.length > 160))
      fail("INVALID_INTAKE_KEY", 400);
    if (
      !input ||
      !text(input.summary) ||
      !text(input.district) ||
      !text(input.citizenRef) ||
      !strings(input.constraints) ||
      !Array.isArray(input.needs) ||
      input.needs.length < 1 ||
      input.needs.length > 20 ||
      input.needs.some(
        (n) =>
          !n ||
          !text(n.description) ||
          !text(n.category) ||
          (n.constraints !== undefined && !strings(n.constraints)),
      )
    )
      fail("INVALID_REQUEST", 400);
    const profile =
      input.citizenProfile === undefined
        ? undefined
        : validateCitizenProfile(input.citizenProfile);
    for (const n of input.needs)
      if (n.requestDetails !== undefined)
        validateRequestDetails(n.requestDetails);
    return this.store.transaction((l) => {
      const canonical = (value: unknown): unknown =>
        Array.isArray(value) ? value.map(canonical) :
        value !== null && typeof value === "object" ? Object.fromEntries(
          Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)])
        ) : value;
      const intakeSignature = input.intakeKey ? createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex") : undefined;
      if (input.intakeKey) {
        const previous = Object.values(l.requests).find(r => r.intakeKey === input.intakeKey);
        if (previous) {
          if (previous.intakeSignature !== intakeSignature) fail("INTAKE_KEY_CONFLICT", 409);
          return previous;
        }
      }
      const at = now();
      const r: SupportRequest = {
        ...(input.intakeKey && intakeSignature ? { intakeKey: input.intakeKey, intakeSignature } : {}),
        id: randomUUID(),
        citizenRef: input.citizenRef,
        ...(profile === undefined ? {} : { citizenProfile: profile }),
        summary: input.summary,
        district: input.district,
        constraints: [...input.constraints],
        needs: input.needs.map((n) => ({
          id: randomUUID(),
          description: n.description,
          category: n.category,
          constraints: [...(n.constraints ?? [])],
          ...(n.requestDetails === undefined
            ? {}
            : { requestDetails: structuredClone(n.requestDetails) }),
          status: "open",
        })),
        revision: 1,
        createdAt: at,
        updatedAt: at,
        inquiries: [],
        attempts: [],
        callbacks: [],
      };
      l.requests[r.id] = r;
      event(l, r, "request-created", r.summary);
      return r;
    });
  }
  listRequests(citizenRef?: string): SupportRequest[] {
    if (citizenRef !== undefined && !boundedText(citizenRef, 160))
      fail("INVALID_CITIZEN_REF", 400);
    return this.store.transaction((l) =>
      Object.values(l.requests)
        .filter((r) => citizenRef === undefined || r.citizenRef === citizenRef)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  getRequest(id: string): SupportRequest | undefined {
    return this.store.transaction((l) => l.requests[id]);
  }
  events(id: string) {
    return this.store.transaction((l) => {
      request(l, id);
      return l.events.filter((e) => e.requestId === id);
    });
  }
  recordConsent(id: string, input: ConsentInput): SupportRequest {
    if (
      !input ||
      !text(input.purpose) ||
      !strings(input.institutionIds) ||
      !input.institutionIds.length ||
      !strings(input.sharedFields) ||
      typeof input.allowCoordination !== "boolean"
    )
      fail("INVALID_CONSENT", 400);
    return this.store.transaction((l) => {
      const r = request(l, id);
      r.consent = structuredClone(input);
      event(l, r, "consent-recorded", input.purpose);
      return r;
    });
  }
  addInquiry(id: string, input: InquiryInput): Inquiry {
    if (
      !input ||
      !text(input.needId) ||
      !text(input.institutionId) ||
      !programs.includes(input.programId) ||
      !text(input.contactPurpose) ||
      !strings(input.questions) ||
      !input.questions.length
    )
      fail("INVALID_INQUIRY", 400);
    return this.store.transaction((l) => {
      const r = request(l, id);
      const n = need(r, input.needId);
      if (n.status === "stopped") fail("NEED_STOPPED");
      if (n.status === "awaiting-choice") fail("CHOICE_REQUIRED");
      const existing = r.inquiries.find(
        (q) =>
          q.revision === r.revision &&
          q.status === "prepared" &&
          q.needId === input.needId &&
          q.institutionId === input.institutionId &&
          q.programId === input.programId &&
          q.contactPurpose === input.contactPurpose &&
          JSON.stringify(q.questions) === JSON.stringify(input.questions),
      );
      if (existing) return existing;
      const q: Inquiry = {
        ...structuredClone(input),
        id: randomUUID(),
        revision: r.revision,
        status: "prepared",
      };
      r.inquiries.push(q);
      event(l, r, "inquiry-prepared", q.id);
      return q;
    });
  }
  startAttempt(
    id: string,
    inquiryId: string,
    idempotencyKey: string,
  ): CallAttempt {
    if (!text(idempotencyKey)) fail("INVALID_IDEMPOTENCY_KEY", 400);
    return this.store.transaction((l) => {
      const r = request(l, id);
      const q = inquiry(r, inquiryId);
      const previous = Object.values(l.requests)
        .flatMap((x) => x.attempts)
        .find((a) => a.idempotencyKey === idempotencyKey);
      if (previous) {
        if (previous.requestId !== id || previous.inquiryId !== inquiryId)
          fail("IDEMPOTENCY_CONFLICT");
        return previous;
      }
      const n = liveNeed(r, q);
      if (q.revision !== r.revision) fail("STALE_INQUIRY");
      const consent = r.consent ?? fail("CONSENT_REQUIRED");
      if (!consent.institutionIds.includes(q.institutionId))
        fail("CONSENT_SCOPE");
      if (n.status === "awaiting-choice") fail("CHOICE_REQUIRED");
      if (
        r.attempts.some(
          (a) =>
            a.status === "unknown" &&
            inquiry(r, a.inquiryId).needId === q.needId,
        )
      )
        fail("RESULT_UNKNOWN");
      if (
        Object.values(l.requests).some((x) =>
          x.attempts.some((a) => a.status === "started"),
        )
      )
        fail("CALL_ACTIVE");
      if (!["prepared", "no-answer", "failed"].includes(q.status))
        fail("INQUIRY_FINAL");
      const a: CallAttempt = {
        id: randomUUID(),
        requestId: id,
        inquiryId,
        idempotencyKey,
        status: "started",
        startedAt: now(),
      };
      r.attempts.push(a);
      q.status = "calling";
      n.status = "contacting";
      event(l, r, "call-started", a.id);
      return a;
    });
  }
  retryInquiry(id: string, inquiryId: string): SupportRequest {
    return this.store.transaction((l) => {
      const r = request(l, id);
      const q = inquiry(r, inquiryId);
      const n = liveNeed(r, q);
      if (q.revision !== r.revision) fail("STALE_INQUIRY");
      if (q.status === "unknown") fail("RESULT_UNKNOWN");
      if (!["failed", "no-answer"].includes(q.status))
        fail("RETRY_NOT_ALLOWED");
      // A completed call can still be processing its answer. Do not race that work.
      const busy = Object.values(l.requests).some(
        (candidate) =>
          candidate.attempts.some((attempt) => attempt.status === "started") ||
          candidate.inquiries.some((item) => item.status === "calling"),
      );
      if (busy) fail("CALL_ACTIVE");
      q.status = "prepared";
      n.status = "open";
      event(l, r, "retry-ready", q.id);
      return r;
    });
  }
  finishAttempt(
    id: string,
    attemptId: string,
    input: AttemptResult,
  ): SupportRequest {
    if (
      !input ||
      !["completed", "no-answer", "failed", "unknown"].includes(input.status) ||
      (input.providerCallId !== undefined && !text(input.providerCallId))
    )
      fail("INVALID_ATTEMPT_RESULT", 400);
    return this.store.transaction((l) => {
      const r = request(l, id);
      const a =
        r.attempts.find((x) => x.id === attemptId) ??
        fail("ATTEMPT_NOT_FOUND", 404);
      if (a.status !== "started") {
        if (
          a.status === input.status &&
          a.providerCallId === input.providerCallId
        )
          return r;
        fail("ATTEMPT_FINAL");
      }
      a.status = input.status;
      a.endedAt = now();
      if (input.providerCallId !== undefined)
        a.providerCallId = input.providerCallId;
      const q = inquiry(r, a.inquiryId);
      const n = need(r, q.needId);
      if (q.status !== "cancelled") {
        q.status = input.status === "completed" ? "calling" : input.status;
        if (n.status !== "stopped" && q.revision === r.revision)
          n.status =
            input.status === "completed" ? "contacting" : "needs-attention";
      }
      event(l, r, "call-finished", `${a.id}:${input.status}`);
      return r;
    });
  }
  recordAnswer(
    id: string,
    inquiryId: string,
    input: AnswerInput,
  ): SupportRequest {
    if (
      !input ||
      !["available", "declined", "alternative"].includes(input.outcome) ||
      !text(input.summary) ||
      !strings(input.conditions) ||
      !text(input.nextAction) ||
      typeof input.requiresChoice !== "boolean"
    )
      fail("INVALID_ANSWER", 400);
    return this.store.transaction((l) => {
      const r = request(l, id);
      const q = inquiry(r, inquiryId);
      const n = liveNeed(r, q);
      if (q.revision !== r.revision) fail("STALE_INQUIRY");
      if (q.answer) {
        if (JSON.stringify(q.answer) === JSON.stringify(input)) return r;
        fail("ANSWER_FINAL");
      }
      const latest = r.attempts.filter((a) => a.inquiryId === inquiryId).at(-1);
      if (!latest || latest.status !== "completed") fail("CALL_NOT_COMPLETED");
      q.answer = structuredClone(input);
      q.status = "answered";
      n.result = `${input.summary}\n${input.nextAction}`;
      n.status =
        input.outcome === "declined"
          ? "needs-attention"
          : input.requiresChoice
            ? "awaiting-choice"
            : input.outcome === "available"
              ? "connected"
              : "open";
      event(l, r, "answer-recorded", `${q.id}:${input.outcome}`);
      return r;
    });
  }
  recordChoice(id: string, needId: string, choice: string): SupportRequest {
    if (!text(choice)) fail("INVALID_CHOICE", 400);
    return this.store.transaction((l) => {
      const r = request(l, id);
      const n = need(r, needId);
      if (n.status !== "awaiting-choice") fail("CHOICE_NOT_EXPECTED");
      n.choice = choice;
      n.status = "open";
      event(l, r, "choice-recorded", `${needId}:${choice}`);
      return r;
    });
  }
  reviseRequest(
    id: string,
    input: {
      summary?: string;
      constraints?: string[];
      district?: string;
      citizenProfile?: CitizenProfile;
    },
  ): SupportRequest {
    if (
      !input ||
      !Object.keys(input).length ||
      Object.keys(input).some(
        (k) => !["summary", "constraints", "district", "citizenProfile"].includes(k),
      ) ||
      (input.summary !== undefined && !text(input.summary)) ||
      (input.district !== undefined && !text(input.district)) ||
      (input.constraints !== undefined && !strings(input.constraints))
    )
      fail("INVALID_REVISION", 400);
    const profile = input.citizenProfile === undefined ? undefined : validateCitizenProfile(input.citizenProfile);
    return this.store.transaction((l) => {
      const r = request(l, id);
      const mergedProfile = profile === undefined ? r.citizenProfile : { ...r.citizenProfile, ...profile };
      const profileChanged = profile !== undefined && (Object.keys(profile) as (keyof CitizenProfile)[]).some((key) => profile[key] !== r.citizenProfile?.[key]);
      const changedSharingFields = ["name", "address"].filter((key) =>
        profileChanged && mergedProfile?.[key as "name" | "address"] !== r.citizenProfile?.[key as "name" | "address"]
      ).map((key) => `citizenProfile.${key}`);
      const summaryChanged =
        input.summary !== undefined && input.summary !== r.summary;
      const districtChanged =
        input.district !== undefined && input.district !== r.district;
      const constraintsChanged =
        input.constraints !== undefined &&
        JSON.stringify([...new Set(input.constraints)].sort()) !==
          JSON.stringify([...new Set(r.constraints)].sort());
      if (!summaryChanged && !districtChanged && !constraintsChanged && !profileChanged) return r;
      if (profileChanged && mergedProfile) {
        r.citizenProfile = mergedProfile;
        if (r.consent) r.consent.sharedFields = r.consent.sharedFields.filter((field) => !changedSharingFields.includes(field));
      }
      if (input.summary !== undefined) r.summary = input.summary;
      if (input.district !== undefined) r.district = input.district;
      if (input.constraints !== undefined)
        r.constraints = [...input.constraints];
      // Revision is the operational agreement version, not a display-edit counter.
      // Shared district/constraints affect all active needs; a summary correction does not.
      if (districtChanged || constraintsChanged || profileChanged) r.revision++;
      if (districtChanged || constraintsChanged) {
        for (const n of r.needs) {
          if (n.status === "stopped") continue;
          n.status = "open";
          delete n.choice;
          delete n.result;
        }
      }
      event(
        l,
        r,
        summaryChanged && !districtChanged && !constraintsChanged && !profileChanged
          ? "summary-corrected"
          : "request-revised",
        String(r.revision),
      );
      return r;
    });
  }

  stopNeed(id: string, needId: string): SupportRequest {
    return this.store.transaction((l) => {
      const r = request(l, id);
      const n = need(r, needId);
      if (n.status === "stopped") return r;
      n.status = "stopped";
      for (const q of r.inquiries)
        if (q.needId === needId && q.status !== "answered")
          q.status = "cancelled";
      event(l, r, "need-stopped", needId);
      return r;
    });
  }
  recordCallback(
    id: string,
    input: {
      idempotencyKey?: string;
      status: "completed" | "no-answer" | "failed";
      summary: string;
    },
  ): SupportRequest {
    if (
      !input ||
      !["completed", "no-answer", "failed"].includes(input.status) ||
      !text(input.summary) ||
      (input.idempotencyKey !== undefined && (!text(input.idempotencyKey) || input.idempotencyKey.length > 160))
    )
      fail("INVALID_CALLBACK", 400);
    return this.store.transaction((l) => {
      const r = request(l, id);
      if (input.idempotencyKey !== undefined) {
        for (const candidate of Object.values(l.requests)) {
          const existing = candidate.callbacks.find(callback => callback.idempotencyKey === input.idempotencyKey);
          if (!existing) continue;
          if (candidate.id !== id || existing.status !== input.status || existing.summary !== input.summary)
            fail("IDEMPOTENCY_CONFLICT");
          return r;
        }
      }
      r.callbacks.push({ ...input, at: now() });
      event(l, r, "callback-recorded", input.summary);
      return r;
    });
  }
}
