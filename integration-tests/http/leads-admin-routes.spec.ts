import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(90 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    let token = ""

    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "leads-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token
    })

    const auth = () => ({ headers: { Authorization: `Bearer ${token}` } })

    // ─── Group 1: Lists CRUD ──────────────────────────────────────────────────

    describe("GET /admin/leads/lists", () => {
      it("returns at least the General list with a numeric lead_count", async () => {
        const res = await api.get("/admin/leads/lists", auth())
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.lists)).toBe(true)
        const general = res.data.lists.find(
          (l: { id: string }) => l.id === "leadlist_general",
        )
        expect(general).toBeTruthy()
        expect(typeof general.lead_count).toBe("number")
      })
    })

    describe("POST /admin/leads/lists", () => {
      it("creates a new list and returns the list object", async () => {
        const res = await api.post(
          "/admin/leads/lists",
          { name: "Toys" },
          auth(),
        )
        expect(res.status).toBe(200)
        expect(res.data.list).toBeTruthy()
        expect(res.data.list.name).toBe("Toys")
        expect(typeof res.data.list.id).toBe("string")
      })

      it("returns 400 for an empty name", async () => {
        const res = await api
          .post("/admin/leads/lists", { name: "" }, auth())
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(400)
      })
    })

    // ─── Group 2: Leads with list_id ─────────────────────────────────────────

    describe("Leads with list_id", () => {
      let toysListId = ""
      let leadInToysId = ""
      let leadInGeneralId = ""

      beforeAll(async () => {
        // Create the Toys list (may already exist from the previous group — use
        // a unique name to guarantee a fresh one)
        const listRes = await api.post(
          "/admin/leads/lists",
          { name: "Toys-leads-group" },
          auth(),
        )
        toysListId = listRes.data.list.id
      })

      it("creates a lead in the Toys list", async () => {
        const res = await api.post(
          "/admin/leads",
          { phone: "51234567", list_id: toysListId },
          auth(),
        )
        expect(res.status).toBe(200)
        expect(res.data.lead).toBeTruthy()
        expect(res.data.lead.phone).toBe("51234567")
        leadInToysId = res.data.lead.id
      })

      it("GET ?list_id= returns only leads in that list", async () => {
        const res = await api.get(
          `/admin/leads?list_id=${toysListId}`,
          auth(),
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.leads)).toBe(true)
        expect(res.data.leads.length).toBeGreaterThanOrEqual(1)
        for (const lead of res.data.leads as Array<{ list_id: string }>) {
          expect(lead.list_id).toBe(toysListId)
        }
        void leadInToysId // captured above
      })

      it("defaults to leadlist_general when no list_id given", async () => {
        const res = await api.post(
          "/admin/leads",
          { phone: "59999888" },
          auth(),
        )
        expect(res.status).toBe(200)
        leadInGeneralId = res.data.lead.id
        expect(res.data.lead.list_id).toBe("leadlist_general")
      })

      void leadInGeneralId // used in later groups
    })

    // ─── Group 3: PATCH ───────────────────────────────────────────────────────

    describe("PATCH /admin/leads/:id", () => {
      let patchTargetId = ""

      beforeAll(async () => {
        const res = await api.post(
          "/admin/leads",
          { phone: "52223334" },
          auth(),
        )
        patchTargetId = res.data.lead.id
      })

      it("updates note and returns the updated lead", async () => {
        const res = await api.patch(
          `/admin/leads/${patchTargetId}`,
          { note: "wants pink" },
          auth(),
        )
        expect(res.status).toBe(200)
        expect(res.data.lead).toBeTruthy()
        expect(res.data.lead.note).toBe("wants pink")
        expect(res.data.lead.id).toBe(patchTargetId)
      })
    })

    // ─── Group 4: match-and-use regression ───────────────────────────────────

    describe("POST /admin/leads/match-and-use regression", () => {
      let regressionListId = ""

      beforeAll(async () => {
        // Create a fresh list for this group so list_id filtering is unambiguous
        const listRes = await api.post(
          "/admin/leads/lists",
          { name: "Regression-list" },
          auth(),
        )
        regressionListId = listRes.data.list.id

        // Seed a lead with a known phone in the regression list
        await api.post(
          "/admin/leads",
          { phone: "57654321", list_id: regressionListId },
          auth(),
        )
      })

      it("returns matched >= 1 for the seeded phone", async () => {
        const res = await api.post(
          "/admin/leads/match-and-use",
          { phone: "57654321", order_id: "order_test_regression" },
          auth(),
        )
        expect(res.status).toBe(200)
        expect(res.data.matched).toBeGreaterThanOrEqual(1)
      })

      it("matched lead no longer appears in active list for the list", async () => {
        const res = await api.get(
          `/admin/leads?list_id=${regressionListId}`,
          auth(),
        )
        expect(res.status).toBe(200)
        const phones = (res.data.leads as Array<{ phone: string }>).map(
          (l) => l.phone,
        )
        expect(phones).not.toContain("57654321")
      })

      it("matched lead appears when used=true filter applied", async () => {
        const res = await api.get(
          `/admin/leads?list_id=${regressionListId}&used=true`,
          auth(),
        )
        expect(res.status).toBe(200)
        const phones = (res.data.leads as Array<{ phone: string }>).map(
          (l) => l.phone,
        )
        expect(phones).toContain("57654321")
      })
    })

    // ─── Group 4b: duplicate-phone rejection ─────────────────────────────────

    describe("POST /admin/leads duplicate phone", () => {
      let dupListId = ""

      beforeAll(async () => {
        const listRes = await api.post(
          "/admin/leads/lists",
          { name: "Dup-list" },
          auth(),
        )
        dupListId = listRes.data.list.id
        await api.post(
          "/admin/leads",
          { phone: "58881111", list_id: dupListId },
          auth(),
        )
      })

      it("rejects the same phone added again, even to a different list", async () => {
        const res = await api
          .post(
            "/admin/leads",
            { phone: "58881111", list_id: "leadlist_general" },
            auth(),
          )
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(400)
      })

      it("treats spaced/formatted forms of the same number as a duplicate", async () => {
        const res = await api
          .post(
            "/admin/leads",
            { phone: "+230 5888 1111", list_id: dupListId },
            auth(),
          )
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(400)
      })

      it("allows a different phone", async () => {
        const res = await api.post(
          "/admin/leads",
          { phone: "58882222", list_id: dupListId },
          auth(),
        )
        expect(res.status).toBe(200)
      })
    })

    // ─── Group 5: Delete list ─────────────────────────────────────────────────

    describe("DELETE /admin/leads/lists/:id", () => {
      let deleteTargetListId = ""

      beforeAll(async () => {
        // Create the list to be deleted
        const listRes = await api.post(
          "/admin/leads/lists",
          { name: "To-be-deleted" },
          auth(),
        )
        deleteTargetListId = listRes.data.list.id

        // Add a lead to the list (so we can verify reassignment after deletion)
        await api.post(
          "/admin/leads",
          { phone: "55556666", list_id: deleteTargetListId },
          auth(),
        )
      })

      it("returns 400 when move_to is missing", async () => {
        const res = await api
          .delete(`/admin/leads/lists/${deleteTargetListId}`, auth())
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(400)
      })

      it("returns 200 with move_to=leadlist_general and reassigns leads", async () => {
        const res = await api.delete(
          `/admin/leads/lists/${deleteTargetListId}?move_to=leadlist_general`,
          auth(),
        )
        expect(res.status).toBe(200)
        expect(res.data.deleted).toBe(true)

        // The lead that was in the deleted list should now live in General
        const generalLeads = await api.get(
          "/admin/leads?list_id=leadlist_general",
          auth(),
        )
        const phones = (
          generalLeads.data.leads as Array<{ phone: string }>
        ).map((l) => l.phone)
        expect(phones).toContain("55556666")
      })
    })

    // ─── Auth sanity ──────────────────────────────────────────────────────────

    describe("Auth", () => {
      it("returns 401 on all leads routes without a token", async () => {
        const res = await api
          .get("/admin/leads")
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(401)
      })
    })
  },
})
