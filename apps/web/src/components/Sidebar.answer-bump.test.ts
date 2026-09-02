import { MessageId, OrchestrationLatestTurn, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findNewCompletedAnswerKeys,
  getAnswerCompletionObservation,
  planAnsweredThreadOrder,
} from "./Sidebar.logic";

function turn(overrides: Partial<Parameters<typeof OrchestrationLatestTurn.make>[0]> = {}) {
  return OrchestrationLatestTurn.make({
    turnId: TurnId.make("turn-1"),
    state: "completed",
    requestedAt: "2026-09-02T12:00:00.000Z",
    startedAt: "2026-09-02T12:00:01.000Z",
    completedAt: "2026-09-02T12:00:02.000Z",
    assistantMessageId: MessageId.make("message-1"),
    ...overrides,
  });
}

describe("getAnswerCompletionObservation", () => {
  it("recognizes only a successful completed turn with an assistant answer", () => {
    expect(getAnswerCompletionObservation(turn())).toEqual({ turnId: "turn-1", completed: true });
    for (const invalid of [
      turn({ state: "running", completedAt: null }),
      turn({ state: "error" }),
      turn({ state: "interrupted" }),
      turn({ assistantMessageId: null }),
      turn({ completedAt: null }),
      turn({ completedAt: "not-a-timestamp" }),
    ]) {
      expect(getAnswerCompletionObservation(invalid)).toEqual({
        turnId: "turn-1",
        completed: false,
      });
    }
  });
});

describe("findNewCompletedAnswerKeys", () => {
  const key = "environment-local:thread-1";
  const running = getAnswerCompletionObservation(turn({ state: "running", completedAt: null }));
  const completed = getAnswerCompletionObservation(turn());

  it("does not replay completed answers during initial hydration", () => {
    expect(
      findNewCompletedAnswerKeys({
        previous: null,
        current: new Map([[key, completed]]),
      }),
    ).toEqual([]);
  });

  it("returns a previously observed active thread when its answer completes", () => {
    expect(
      findNewCompletedAnswerKeys({
        previous: new Map([[key, running]]),
        current: new Map([[key, completed]]),
      }),
    ).toEqual([key]);
  });

  it("ignores first-seen, unchanged, and no-longer-active keys", () => {
    expect(
      findNewCompletedAnswerKeys({
        previous: new Map([
          [key, completed],
          ["environment-local:no-longer-active", null],
        ]),
        current: new Map([
          [key, completed],
          ["environment-local:first-seen", completed],
        ]),
      }),
    ).toEqual([]);
  });

  it("recognizes a new completed turn but ignores a timestamp update to the same completion", () => {
    const nextTurnCompleted = getAnswerCompletionObservation(
      turn({ turnId: TurnId.make("turn-2") }),
    );
    const updatedTimestamp = getAnswerCompletionObservation(
      turn({ completedAt: "2026-09-02T12:00:03.000Z" }),
    );

    expect(
      findNewCompletedAnswerKeys({
        previous: new Map([[key, running]]),
        current: new Map([[key, nextTurnCompleted]]),
      }),
    ).toEqual([key]);
    expect(
      findNewCompletedAnswerKeys({
        previous: new Map([[key, completed]]),
        current: new Map([[key, updatedTimestamp]]),
      }),
    ).toEqual([]);
  });
});

describe("planAnsweredThreadOrder", () => {
  it("promotes simultaneous answers newest-first without disturbing the manual remainder", () => {
    expect(
      planAnsweredThreadOrder({
        orderedKeys: ["manual-a", "answered-old", "manual-b", "answered-new"],
        newlyCompletedKeys: ["answered-old", "answered-new", "stale"],
        completedAtByKey: new Map([
          ["answered-old", "2026-09-02T12:00:02.000Z"],
          ["answered-new", "2026-09-02T12:00:03.000Z"],
        ]),
      }),
    ).toEqual(["answered-new", "answered-old", "manual-a", "manual-b"]);
  });
});
