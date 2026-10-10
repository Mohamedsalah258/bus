import "dotenv/config";
import { Pool } from "pg";
import { hashPassword } from "../src/modules/auth/password.js";
async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.BOOTSTRAP_ADMIN_NAME ?? "").trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    name.length < 2 ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error(
      "Set valid BOOTSTRAP_ADMIN_EMAIL, NAME and a 12–128 character PASSWORD.",
    );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      // The operator typed this address; it is treated as verified.
      "INSERT INTO users(email,name,password_hash,role,email_verified_at) VALUES($1,$2,$3,'ADMIN',now())",
      [email, name, await hashPassword(password)],
    );
    console.log(
      "Admin created. Remove bootstrap password from the environment.",
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Admin creation failed. Check inputs, database and whether email already exists. Existing accounts are never promoted automatically.",
  );
  process.exitCode = 1;
});
