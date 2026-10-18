import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Photon } from "@photon-ai/api";
import { sendText, usePhotonForTests } from "../src/channels/photon.js";

interface SeenCall {
  name: string;
  platform?: string;
}

describe("outbound text platform", () => {
  const previous = {
    key: process.env.PHOTON_API_KEY,
    project: process.env.PHOTON_PROJECT_ID,
    agent: process.env.PHOTON_AGENT_USER_ID,
  };

  after(() => {
    usePhotonForTests(undefined);
    restore("PHOTON_API_KEY", previous.key);
    restore("PHOTON_PROJECT_ID", previous.project);
    restore("PHOTON_AGENT_USER_ID", previous.agent);
  });

  it("sends a text on iMessage and does not open an SMS conversation", async () => {
    const seen: SeenCall[] = [];
    process.env.PHOTON_API_KEY = "test-key";
    process.env.PHOTON_PROJECT_ID = "pho_prj_test";
    delete process.env.PHOTON_AGENT_USER_ID;
    usePhotonForTests(fakePhoton(seen));

    const sent = await sendText("+12065550100", "hello");

    assert.equal(sent.platform, "imessage");
    assert.deepEqual(
      seen.flatMap((call) => (call.platform === undefined ? [] : [call.platform])),
      ["imessage", "imessage", "imessage"],
    );
    assert.equal(
      seen.some((call) => call.platform === "sms"),
      false,
    );
    assert.equal(seen.filter((call) => call.name === "send").length, 1);
  });
});

function fakePhoton(seen: SeenCall[]): Photon {
  return {
    projects: {
      async createOrGetUser(args: { body: { platform: string } }) {
        seen.push({ name: "user", platform: args.body.platform });
        return { id: "usr_1" };
      },
      async listUsers(args: { query: { platform: string } }) {
        seen.push({ name: "list", platform: args.query.platform });
        return { items: [{ id: "agt_1", platform: args.query.platform, kind: "agent" }] };
      },
      async createOrGetSpace(args: { body: { platform: string } }) {
        seen.push({ name: "space", platform: args.body.platform });
        return { id: "spc_1" };
      },
      async sendMessage() {
        seen.push({ name: "send" });
        return { id: "msg_1", status: "dispatched" };
      },
    },
  } as unknown as Photon;
}

function restore(name: "PHOTON_API_KEY" | "PHOTON_PROJECT_ID" | "PHOTON_AGENT_USER_ID", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
