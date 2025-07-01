import { getCollection } from 'astro:content';

export interface Brand {
    name: string;
    slug: string;
    toolCount: number;
}

/**
 * Derives brands data from the tools collection
 */
export async function getBrandsFromTools(): Promise<Brand[]> {
  const toolsData = await getCollection('tools');
    
  // Create a map to count tools by brand
  const brandCounts = new Map<string, number>();
  
  toolsData.forEach(tool => {
    const brand = tool.data.toolBrand;
    brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
  });
  
  // Convert to brands array
  const brands: Brand[] = Array.from(brandCounts.entries()).map(([name, toolCount]) => ({
    name,
    slug: normalizeSlug(name),
    toolCount
  }));
  
  // Sort by tool count (descending)
  return brands.sort((a, b) => b.toolCount - a.toolCount);
}

/**
 * Get tools data
 */
export async function getTools() {
  const toolsData = await getCollection('tools');
  return toolsData;
}

export function normalizeSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}