import { z, defineCollection } from "astro:content";
import { file } from "astro/loaders";

const toolsCollection = defineCollection({
  loader: file("src/data/tools.json"),
  schema: z.object({
    modelNumber: z.string(),
    toolBrand: z.string(),
    name: z.string(),
    stores: z.array(
      z.object({
        store: z.string(),
        name: z.string(),
        price: z.object({
          rrp: z.number().nullable(),
          promo: z.number().nullable(),
        }),
        url: z.string().url(),
        effectivePrice: z.number().nullable(), // Allow null for missing price data
      })
    ),
    storeCount: z.number(),
    priceRange: z.object({
      min: z.number().nullable(), // Allow null for missing price data
      max: z.number().nullable(), // Allow null for missing price data
    }),
    categories: z.array(z.string()).optional(),
  }),
});

export const collections = {
  tools: toolsCollection,
};
