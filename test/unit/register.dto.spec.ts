import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RegisterDto } from "../../src/modules/auth/dto/register.dto.js";

test("registration rejects injected role and normalizes email", async () => {
  const dto = plainToInstance(RegisterDto, {
    email: "  User@example.com ",
    password: "long test password",
    name: "Test User",
    facultyId: "1059a2d8-7f60-4217-9700-970fa8c498d7",
    role: "ADMIN",
  });
  assert.equal(dto.email, "user@example.com");
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  assert(errors.some((error) => error.property === "role"));
});
