import { Module } from "@medusajs/framework/utils"

import FeedPostsModuleService from "./service"

export const FEED_POSTS_MODULE = "feed_posts"

export default Module(FEED_POSTS_MODULE, {
  service: FeedPostsModuleService,
})
