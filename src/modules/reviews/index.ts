import { Module } from "@medusajs/framework/utils"
import ReviewsModuleService from "./service"
export const REVIEWS_MODULE = "reviews"
export default Module(REVIEWS_MODULE, { service: ReviewsModuleService })
