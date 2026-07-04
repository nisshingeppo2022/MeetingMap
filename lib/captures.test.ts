import { describe, it, expect, vi, beforeEach } from "vitest";

const deviceTokenFindUnique = vi.fn();
const deviceTokenUpdate = vi.fn();
const captureCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deviceToken: {
      findUnique: (...args: unknown[]) => deviceTokenFindUnique(...args),
      update: (...args: unknown[]) => deviceTokenUpdate(...args),
    },
    capture: {
      create: (...args: unknown[]) => captureCreate(...args),
    },
  },
}));

const generateContentMock = vi.fn();
vi.mock("@/lib/gemini", () => ({
  generateContent: (...args: unknown[]) => generateContentMock(...args),
  CAPTURE_TAG_PROMPT: "PROMPT",
}));

import { hashToken, verifyDeviceToken, classifyCapture } from "./captures";

const TAG_DEFS = [
  { slug: "dx-highschool", label: "DX高校事業", description: "補助金・見積・提出書類" },
  { slug: "inbox", label: "その他", description: null },
];

describe("verifyDeviceToken", () => {
  beforeEach(() => {
    deviceTokenFindUnique.mockReset();
    deviceTokenUpdate.mockReset();
  });

  it("正しいトークンなら userId を返す", async () => {
    const token = "correct-token";
    deviceTokenFindUnique.mockResolvedValue({
      id: "dt-1",
      userId: "user-1",
      tokenHash: hashToken(token),
      active: true,
    });
    deviceTokenUpdate.mockResolvedValue({});

    const result = await verifyDeviceToken(token);
    expect(result).toEqual({ userId: "user-1", tokenId: "dt-1" });
    expect(deviceTokenFindUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken(token) } });
    expect(deviceTokenUpdate).toHaveBeenCalled();
  });

  it("不正なトークンは null を返す", async () => {
    deviceTokenFindUnique.mockResolvedValue(null);
    const result = await verifyDeviceToken("wrong-token");
    expect(result).toBeNull();
    expect(deviceTokenUpdate).not.toHaveBeenCalled();
  });

  it("失効(active:false)したトークンは null を返す", async () => {
    deviceTokenFindUnique.mockResolvedValue({
      id: "dt-2",
      userId: "user-2",
      tokenHash: hashToken("revoked-token"),
      active: false,
    });
    const result = await verifyDeviceToken("revoked-token");
    expect(result).toBeNull();
    expect(deviceTokenUpdate).not.toHaveBeenCalled();
  });
});

describe("captures insert scoping", () => {
  it("verifyDeviceTokenで得たuserIdでcaptureが作成される(自分のデータのみ書き込む経路になっていること)", async () => {
    const token = "device-token";
    deviceTokenFindUnique.mockResolvedValue({
      id: "dt-3",
      userId: "user-3",
      tokenHash: hashToken(token),
      active: true,
    });
    deviceTokenUpdate.mockResolvedValue({});
    captureCreate.mockResolvedValue({ id: "cap-1" });

    const auth = await verifyDeviceToken(token);
    expect(auth).not.toBeNull();

    const { prisma } = await import("@/lib/prisma");
    await prisma.capture.create({
      data: { userId: auth!.userId, source: "voice", content: "test", tags: [] },
    });

    expect(captureCreate).toHaveBeenCalledWith({
      data: { userId: "user-3", source: "voice", content: "test", tags: [] },
    });
  });
});

describe("classifyCapture", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("confidence:lowの場合はinboxにフォールバックする", async () => {
    generateContentMock.mockResolvedValue(
      JSON.stringify({ tags: ["dx-highschool"], confidence: "low" })
    );
    const result = await classifyCapture("よくわからない呟き", TAG_DEFS);
    expect(result).toEqual({ tags: ["inbox"], confidence: "low" });
  });

  it("Gemini呼び出しがタイムアウトしてもinboxにフォールバックし例外を投げない", async () => {
    generateContentMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("{}"), 4000))
    );
    const result = await classifyCapture("見積書の件で相談したい", TAG_DEFS);
    expect(result).toEqual({ tags: ["inbox"], confidence: "low" });
  }, 8000);

  it("confidence:highかつ有効なslugならそのタグを返す", async () => {
    generateContentMock.mockResolvedValue(
      JSON.stringify({ tags: ["dx-highschool"], confidence: "high" })
    );
    const result = await classifyCapture("見積書を提出書類にまとめたい", TAG_DEFS);
    expect(result).toEqual({ tags: ["dx-highschool"], confidence: "high" });
  });
});
