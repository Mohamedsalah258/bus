import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../support/test-app.js";

const PASSWORD = "member test password";

test("BL-03: categories gate routes; coordinators only see and review their faculty", async () => {
  const t = await createTestApp();
  const { api } = t;
  try {
    const admin = await t.adminBearer();
    const post = (path: string, body: object, auth = admin) =>
      api.post(`/api/v1${path}`).set("Authorization", auth).send(body);

    const science = (await post("/faculties", { name: "Science" }).expect(201))
      .body;
    const law = (await post("/faculties", { name: "Law" }).expect(201)).body;
    const employee = await t.createCategory("EMPLOYEE", "موظف");
    const student = await t.createCategory("student", "طالب");
    assert.equal(student.code, "STUDENT", "codes are normalized");

    // Public listing, used by the registration form.
    const categories = (await api.get("/api/v1/categories").expect(200)).body;
    assert.equal(categories.total, 2);

    const route = (
      await post("/routes", {
        name: "Staff route",
        stops: [{ name: "Stop A" }, { name: "Stop B" }],
        eligibleCategoryIds: [employee.id],
      }).expect(201)
    ).body;
    await post("/routes", {
      name: "Bad route",
      stops: [{ name: "Stop A" }, { name: "Stop B" }],
      eligibleCategoryIds: ["1059a2d8-7f60-4217-9700-970fa8c498d7"],
    }).expect(400);
    const season = (
      await post("/seasons", {
        name: "Season 2026",
        startsOn: "2000-01-01",
        endsOn: "2099-12-31",
      }).expect(201)
    ).body;

    const register = (email: string, facultyId: string, categoryId: string) =>
      t.registerMember({ email, facultyId, categoryId, password: PASSWORD });
    const scienceEmployee = await register(
      "emp.sci@test.example",
      science.id,
      employee.id,
    );
    const lawEmployee = await register(
      "emp.law@test.example",
      law.id,
      employee.id,
    );
    const scienceStudent = await register(
      "stu.sci@test.example",
      science.id,
      student.id,
    );
    await api
      .post("/api/v1/auth/register")
      .send({
        email: "x@test.example",
        password: PASSWORD,
        name: "Applicant X",
        facultyId: science.id,
        categoryId: "1059a2d8-7f60-4217-9700-970fa8c498d7",
      })
      .expect(400);

    const plan = await t.createPlan(season.id);
    const request = { planId: plan.id, routeId: route.id };
    const sciSub = (
      await post("/subscriptions", request, scienceEmployee).expect(201)
    ).body;
    const lawSub = (
      await post("/subscriptions", request, lawEmployee).expect(201)
    ).body;

    // A student may not subscribe to a staff route until the route allows it.
    const denied = await post("/subscriptions", request, scienceStudent).expect(
      403,
    );
    assert.match(denied.body.message, /category is not eligible/);
    const widened = (
      await api
        .put(`/api/v1/routes/${route.id}/eligible-categories`)
        .set("Authorization", admin)
        .send({
          categoryIds: [employee.id, student.id],
          reason: "Pilot for students",
        })
        .expect(200)
    ).body;
    assert.equal(widened.eligibleCategoryIds.length, 2);
    await post("/subscriptions", request, scienceStudent).expect(201);

    // Coordinator of Science, created by an administrator.
    const coordinatorAccount = {
      email: "coord.sci@test.example",
      name: "Science coordinator",
      role: "FACULTY_COORDINATOR",
      temporaryPassword: "temporary password 1",
    };
    await post("/users", coordinatorAccount).expect(400); // no faculty
    const coordinator = (
      await post("/users", {
        ...coordinatorAccount,
        facultyId: science.id,
      }).expect(201)
    ).body;
    assert.equal(coordinator.passwordChangeRequired, true);

    // Temporary password: nothing works until it is changed.
    const temp = await t.bearer(
      coordinatorAccount.email,
      coordinatorAccount.temporaryPassword,
    );
    // First gate: confirm the email the administrator typed.
    const emailGate = await api
      .get("/api/v1/subscriptions")
      .set("Authorization", temp)
      .expect(403);
    assert.match(emailGate.body.message, /Email verification required/);
    await t.verifyEmail(temp, coordinatorAccount.email);
    const mustChange = await api
      .get("/api/v1/subscriptions")
      .set("Authorization", temp)
      .expect(403);
    assert.match(mustChange.body.message, /Password change required/);
    await post(
      "/auth/password",
      {
        currentPassword: "wrong password!!",
        newPassword: "coordinator password",
      },
      temp,
    ).expect(401);
    const changed = (
      await post(
        "/auth/password",
        {
          currentPassword: coordinatorAccount.temporaryPassword,
          newPassword: "coordinator password",
        },
        temp,
      ).expect(200)
    ).body;
    await api.get("/api/v1/auth/me").set("Authorization", temp).expect(401);
    const coord = `Bearer ${changed.accessToken}`;

    // Sees Science applicants only, with applicant details for review.
    const queue = (
      await api
        .get("/api/v1/subscriptions?status=PENDING")
        .set("Authorization", coord)
        .expect(200)
    ).body;
    assert.equal(queue.total, 2);
    assert.ok(
      queue.items.every((s: any) => s.applicantFacultyId === science.id),
    );
    assert.ok(
      queue.items.some((s: any) => s.applicantEmail === "emp.sci@test.example"),
    );

    const review = (id: string) =>
      api
        .patch(`/api/v1/subscriptions/${id}/review`)
        .set("Authorization", coord)
        .send({ status: "APPROVED", reason: "Checked against faculty list" });
    const foreign = await review(lawSub.id).expect(403);
    assert.match(foreign.body.message, /another faculty/);
    await review(sciSub.id).expect(200);

    // Coordinators have no operational permissions.
    await post("/trips", {}, coord).expect(403);
    await api
      .get("/api/v1/audit-events")
      .set("Authorization", coord)
      .expect(403);

    // The administrator still sees all three requests.
    const all = (
      await api
        .get("/api/v1/subscriptions")
        .set("Authorization", admin)
        .expect(200)
    ).body;
    assert.equal(all.total, 3);
  } finally {
    await t.close();
  }
});

test("BL-04: role changes, deactivation and resets are audited and take effect immediately", async () => {
  const t = await createTestApp();
  const { api, database } = t;
  try {
    const admin = await t.adminBearer();
    const adminId = (
      await api.get("/api/v1/auth/me").set("Authorization", admin).expect(200)
    ).body.id;
    const auth = (token: string) => ({ Authorization: token });

    // Self-protection.
    await api
      .patch(`/api/v1/users/${adminId}/status`)
      .set(auth(admin))
      .send({ active: false, reason: "testing self" })
      .expect(403);
    await api
      .patch(`/api/v1/users/${adminId}/role`)
      .set(auth(admin))
      .send({ role: "MEMBER", reason: "testing self" })
      .expect(403);

    // A dispatcher must change the temporary password AND enrol MFA.
    const dispatcher = (
      await api
        .post("/api/v1/users")
        .set(auth(admin))
        .send({
          email: "Dispatch@Test.Example",
          name: "Dispatcher",
          role: "DISPATCHER",
          temporaryPassword: "temporary password 2",
        })
        .expect(201)
    ).body;
    assert.equal(dispatcher.email, "dispatch@test.example");
    let token = await t.bearer("dispatch@test.example", "temporary password 2");
    await t.verifyEmail(token, "dispatch@test.example");
    token =
      "Bearer " +
      (
        await api
          .post("/api/v1/auth/password")
          .set(auth(token))
          .send({
            currentPassword: "temporary password 2",
            newPassword: "dispatcher password",
          })
          .expect(200)
      ).body.accessToken;
    const mfaBlock = await api
      .get("/api/v1/vehicles")
      .set(auth(token))
      .expect(403);
    assert.match(mfaBlock.body.message, /Two-factor/);
    const { secret } = await t.enrollMfa(token);
    token = await t.mfaBearer(
      "dispatch@test.example",
      "dispatcher password",
      secret,
    );
    await api.get("/api/v1/vehicles").set(auth(token)).expect(200);

    // Lost phone: an administrator resets MFA; sessions end, enrolment is due again.
    await api
      .post(`/api/v1/users/${dispatcher.id}/mfa/reset`)
      .set(auth(admin))
      .send({ reason: "Phone lost, identity checked in person" })
      .expect(200);
    await api.get("/api/v1/vehicles").set(auth(token)).expect(401);
    const afterReset = await t.bearer(
      "dispatch@test.example",
      "dispatcher password",
    );
    await api.get("/api/v1/vehicles").set(auth(afterReset)).expect(403);

    // Demotion takes effect on the very next request.
    const demoted = (
      await api
        .patch(`/api/v1/users/${dispatcher.id}/role`)
        .set(auth(admin))
        .send({ role: "AUDITOR", reason: "Moved to oversight" })
        .expect(200)
    ).body;
    assert.equal(demoted.role, "AUDITOR");
    await api.get("/api/v1/audit-events").set(auth(afterReset)).expect(200);
    await api
      .post("/api/v1/vehicles")
      .set(auth(afterReset))
      .send({})
      .expect(403);
    await api
      .patch(`/api/v1/users/${adminId}/role`)
      .set(auth(afterReset))
      .send({ role: "MEMBER", reason: "auditor cannot" })
      .expect(403);

    // Deactivation ends every session immediately, refresh tokens included.
    const session = await t.login(
      "dispatch@test.example",
      "dispatcher password",
    );
    await api
      .patch(`/api/v1/users/${dispatcher.id}/status`)
      .set(auth(admin))
      .send({ active: false, reason: "Left the transport office" })
      .expect(200);
    await api.get("/api/v1/auth/me").set(auth(afterReset)).expect(401);
    await api
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    await api
      .post("/api/v1/auth/login")
      .send({ email: "dispatch@test.example", password: "dispatcher password" })
      .expect(401);

    // Reactivation plus an administrative password reset.
    await api
      .patch(`/api/v1/users/${dispatcher.id}/status`)
      .set(auth(admin))
      .send({ active: true, reason: "Returned" })
      .expect(200);
    const reset = (
      await api
        .post(`/api/v1/users/${dispatcher.id}/password/reset`)
        .set(auth(admin))
        .send({
          temporaryPassword: "temporary password 3",
          reason: "Forgot it",
        })
        .expect(200)
    ).body;
    assert.equal(reset.passwordChangeRequired, true);

    // Filtering and search.
    const auditors = (
      await api
        .get("/api/v1/users?role=AUDITOR&search=dispatch")
        .set(auth(admin))
        .expect(200)
    ).body;
    assert.equal(auditors.total, 1);
    const none = (
      await api.get("/api/v1/users?search=%25").set(auth(admin)).expect(200)
    ).body;
    assert.equal(none.total, 0, "LIKE wildcards are matched literally");

    // Every change left a reasoned audit entry.
    const { rows } = await database.query(
      "SELECT action, metadata FROM audit_events WHERE entity_id=$1 ORDER BY created_at",
      [dispatcher.id],
    );
    const actions = rows.map((r: any) => r.action);
    for (const action of [
      "USER_CREATED",
      "MFA_ENABLED",
      "MFA_RESET",
      "USER_ROLE_CHANGED",
      "USER_DEACTIVATED",
      "USER_ACTIVATED",
      "USER_PASSWORD_RESET",
    ])
      assert.ok(actions.includes(action), action);
    const roleChange = rows.find((r: any) => r.action === "USER_ROLE_CHANGED");
    assert.deepEqual(
      [
        roleChange.metadata.from,
        roleChange.metadata.to,
        roleChange.metadata.reason,
      ],
      ["DISPATCHER", "AUDITOR", "Moved to oversight"],
    );
  } finally {
    await t.close();
  }
});
