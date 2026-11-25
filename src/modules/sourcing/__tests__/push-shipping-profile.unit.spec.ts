/**
 * Regression: the 24 Nov 2026 collection30 push created 126 products with no
 * shipping profile. Medusa's completeCartWorkflow (validateShippingStep) then
 * rejected every cart holding one of them with "The cart items require
 * shipping profiles that are not satisfied by the current shipping methods",
 * so nobody could check out a new-collection item until they were linked by hand.
 */
const createProductsRun = jest.fn()
const createInventoryLevelsRun = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  createProductsWorkflow: () => ({ run: createProductsRun }),
  createInventoryLevelsWorkflow: () => ({ run: createInventoryLevelsRun }),
  updateProductsWorkflow: () => ({ run: jest.fn() }),
  deleteProductsWorkflow: () => ({ run: jest.fn() }),
}))

import SourcingModuleService from "../service"

const LIVE_DEFAULT_PROFILE = "sp_01KN07JARKWGN9ZRHK9ABB5EGM"

function makeService() {
  const svc = Object.create(SourcingModuleService.prototype)
  Object.assign(svc, {
    retrieveDraft: jest.fn().mockResolvedValue({ id: "dord_1" }),
    validateForPush: jest.fn().mockResolvedValue({ ok: true, items: [] }),
    listDraftItems: jest.fn().mockResolvedValue([
      {
        id: "ditm_1",
        working_name: "Cute Top",
        selling_price_mur: 850,
        scraped_image_url: null,
        uploaded_image_r2_key: null,
        color_images: null,
        category_id: null,
        published_product_id: null,
        ref: "IS9001",
      },
    ]),
    listDraftVariants: jest.fn().mockResolvedValue([
      {
        id: "dvar_1",
        color: null,
        size: "M",
        qty: 2,
        received_qty: null,
        override_price_mur: null,
      },
    ]),
    assignItemRef: jest.fn(),
    markItemPublished: jest.fn(),
    clearItemRef: jest.fn(),
  })
  return svc as SourcingModuleService
}

const container = {
  resolve: () => ({
    graph: jest.fn().mockResolvedValue({
      data: [
        {
          id: "variant_1",
          sku: "IS9001-M",
          inventory_items: [{ inventory: { id: "iitem_1" } }],
        },
      ],
    }),
  }),
}

describe("pushDraftToMedusa shipping profile", () => {
  const saved = process.env.MEDUSA_DEFAULT_SHIPPING_PROFILE_ID

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.MEDUSA_DEFAULT_SHIPPING_PROFILE_ID
    createProductsRun.mockResolvedValue({ result: [{ id: "prod_1" }] })
    createInventoryLevelsRun.mockResolvedValue({ result: [] })
  })

  afterAll(() => {
    if (saved === undefined) delete process.env.MEDUSA_DEFAULT_SHIPPING_PROFILE_ID
    else process.env.MEDUSA_DEFAULT_SHIPPING_PROFILE_ID = saved
  })

  it("links every pushed product to the default shipping profile", async () => {
    const result = await makeService().pushDraftToMedusa("dord_1", container)

    expect(result.failed).toEqual([])
    expect(createProductsRun).toHaveBeenCalledTimes(1)
    const product = createProductsRun.mock.calls[0][0].input.products[0]
    expect(product.shipping_profile_id).toBe(LIVE_DEFAULT_PROFILE)
  })

  it("uses MEDUSA_DEFAULT_SHIPPING_PROFILE_ID when it is set", async () => {
    process.env.MEDUSA_DEFAULT_SHIPPING_PROFILE_ID = "sp_from_env"

    await makeService().pushDraftToMedusa("dord_1", container)

    const product = createProductsRun.mock.calls[0][0].input.products[0]
    expect(product.shipping_profile_id).toBe("sp_from_env")
  })
})
