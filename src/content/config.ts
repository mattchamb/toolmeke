import { z, defineCollection } from 'astro:content';

// Define the tool schema
export const toolSchema = z.object({
  modelNumber: z.string(),
  toolBrand: z.string(),
  name: z.string(),
  stores: z.array(z.object({
    store: z.string(),
    name: z.string(),
    price: z.object({
      rrp: z.number().nullable(),
      promo: z.number().nullable()
    }),
    url: z.string().url(),
    effectivePrice: z.number().nullable() // Allow null for missing price data
  })),
  storeCount: z.number(),
  priceRange: z.object({
    min: z.number().nullable(), // Allow null for missing price data
    max: z.number().nullable()  // Allow null for missing price data
  }),
  categories: z.array(z.string()).optional()
});

// For this use case with a large JSON array, we'll use a data collection
const toolsCollection = defineCollection({
  type: 'data',
  schema: z.array(toolSchema)
});

// Define the brands collection
const brandsCollection = defineCollection({
  type: 'data',
  schema: z.array(z.object({
    name: z.string(),
    slug: z.string(),
    toolCount: z.number()
  }))
});

export const collections = {
  tools: toolsCollection,
  brands: brandsCollection,
};
