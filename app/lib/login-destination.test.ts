import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import { getLoginDestination } from "./login-destination";

describe("getLoginDestination", () => {
  it("sends an instructor to the analytics dashboard when no redirectTo is given", () => {
    expect(getLoginDestination(UserRole.Instructor, null)).toBe(
      "/instructor/analytics"
    );
  });

  it("respects an explicit redirectTo for an instructor", () => {
    expect(getLoginDestination(UserRole.Instructor, "/redeem/ABC123")).toBe(
      "/redeem/ABC123"
    );
  });

  it("ignores a redirectTo that does not start with /", () => {
    expect(
      getLoginDestination(UserRole.Instructor, "https://evil.example")
    ).toBe("/instructor/analytics");
  });

  it("respects an explicit redirectTo for a student", () => {
    expect(getLoginDestination(UserRole.Student, "/redeem/ABC123")).toBe(
      "/redeem/ABC123"
    );
  });

  it.each([UserRole.Student, UserRole.Admin])(
    "keeps sending a %s to the course catalog",
    (role) => {
      expect(getLoginDestination(role, null)).toBe("/courses");
    }
  );
});
