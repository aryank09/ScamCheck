// iMessage commands: LANGUAGE, FAMILY, HELP, STOP, PAID, CLICKED.
// Photon sends and database writes are TODOs. The caller persists `patch` and sends `reply`.

import type { UserAction } from "./db/cases.js";
import type { OnboardingStep, User } from "./db/users.js";

export type CommandName = "LANGUAGE" | "FAMILY" | "HELP" | "STOP" | "PAID" | "CLICKED";

export interface CommandPatch {
  onboardingStep?: OnboardingStep;
  /** STOP: revoke the Gmail refresh token, then delete the user and their cases. */
  deleteUser?: boolean;
  revokeGmail?: boolean;
  /** PAID or CLICKED. Stored on the latest case. */
  userAction?: Extract<UserAction, "paid" | "clicked">;
  /** Urgent path: alert family with who and the scam type only. Never send the original message. */
  alertFamily?: boolean;
}

export interface CommandResult {
  handled: boolean;
  command?: CommandName;
  reply: string;
  patch?: CommandPatch;
}

const COMMANDS = new Set<string>(["LANGUAGE", "FAMILY", "HELP", "STOP", "PAID", "CLICKED"]);

/** Match a command word, or report that this text is not a command. */
export function handleCommand(text: string, user: User): CommandResult {
  const command = parseCommand(text);
  if (!command) return { handled: false, reply: "" };

  switch (command) {
    case "LANGUAGE":
      return {
        handled: true,
        command,
        reply: "What language should I use? You can reply Urdu, español, हिंदी, or English.",
        patch: { onboardingStep: "language" },
      };
    case "FAMILY":
      return {
        handled: true,
        command,
        reply: "Want family alerts? Send their name and number, or reply SKIP.",
        patch: { onboardingStep: "family" },
      };
    case "HELP":
      return {
        handled: true,
        command,
        reply:
          "Forward me a message, or call me, and I will check it. " +
          "LANGUAGE changes the language. FAMILY adds someone I can alert. STOP deletes your data.",
      };
    case "STOP":
      return stop(user);
    case "PAID":
      return urgent("PAID", "paid");
    case "CLICKED":
      return urgent("CLICKED", "clicked");
  }
}

export function parseCommand(text: string): CommandName | undefined {
  const first = text.trim().split(/\s+/)[0]?.replace(/[.!]+$/g, "").toUpperCase();
  if (!first || !COMMANDS.has(first)) return undefined;
  return first as CommandName;
}

function stop(user: User): CommandResult {
  // TODO: revoke user.gmail.refreshTokenEnc, delete the user, and delete their cases.
  // Do not log the token or the full phone number.
  const reply = user.gmail
    ? "Your ScamCheck data has been deleted, and the Gmail connection is removed."
    : "Your ScamCheck data has been deleted.";
  return {
    handled: true,
    command: "STOP",
    reply,
    patch: { deleteUser: true, revokeGmail: true },
  };
}

function urgent(command: "PAID" | "CLICKED", userAction: "paid" | "clicked"): CommandResult {
  // TODO: alert family immediately, then offer or place a call. Do not include the original message.
  return {
    handled: true,
    command,
    reply:
      "Call your bank right away. Use the number on your card, not a number from the message. " +
      "I will tell your family, and I can call you too.",
    patch: { userAction, alertFamily: true },
  };
}
