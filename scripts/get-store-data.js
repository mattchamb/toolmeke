#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';
import { GET_CATEGORIES_QUERY, GET_PRODUCTS_QUERY } from './sydney-tools-queries.js';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const SCRIPT_DATA_DIR = path.join(SCRIPT_DIR, 'data');

// Ensure data directory exists
await fs.mkdir(SCRIPT_DATA_DIR, { recursive: true });

// Normalize brand names
const BRAND_MAPPING = new Map([
    ['dewalt', 'DEWALT'],
    ['milwaukee', 'Milwaukee'],
    ['hikoki', 'HiKOKI'],
    ['makita lxt', 'Makita'],
    ['makita xgt', 'Makita'],
    ['makita', 'Makita'],
    ['bosch professional', 'Bosch'],
    ['bosch', 'Bosch'],
    ['aeg', 'AEG'],
    ['festool', 'Festool'],
    ['metabo', 'Metabo'],
    ['paslode', 'Paslode'],
    ['ryobi', 'Ryobi'],
    ['black+decker', 'Black+Decker'],
    ['toolshed', 'ToolShed']
]);

function normalizeBrand(brand) {
    const normalized = brand.toLowerCase();
    return BRAND_MAPPING.get(normalized) || brand;
}

// Helper function to parse price
const parsePrice = (price) => price && price !== 'null' ? parseFloat(price) : null;

// Create standardized tool JSON
function createToolJson(brand, name, modelNumber, priceRrp, pricePromo, url, store) {
    return {
        toolBrand: normalizeBrand(brand),
        name,
        modelNumber: modelNumber || '',
        price: {
            rrp: parsePrice(priceRrp),
            promo: parsePrice(pricePromo)
        },
        url,
        store
    };
}

// Sleep utility
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with retries and error handling
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    const defaultOptions = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        timeout: 30000,
        ...options
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), defaultOptions.timeout);
            
            const response = await fetch(url, {
                ...defaultOptions,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                // Don't retry on 404 errors - the resource doesn't exist
                if (response.status === 404) {
                    throw error;
                }
                throw error;
            }
            
            return response;
        } catch (error) {
            console.error(`  Attempt ${attempt}/${maxRetries} failed:`, error.message);
            // Don't retry on 404 errors or if this is the last attempt
            if (error.message.includes('HTTP 404') || attempt === maxRetries) {
                throw error;
            }
            await sleep(1000 * attempt); // Exponential backoff
        }
    }
}

// Store configurations
const STORE_CONFIG = {
    bunnings: {
        name: 'Bunnings',
        brands: ['DEWALT', 'Bosch Professional', 'Makita', 'AEG', 'Makita LXT', 'Makita XGT', 'Paslode'],
        baseUrl: 'https://www.bunnings.co.nz'
    },
    mitre10: {
        name: 'Mitre10',
        brands: ['Bosch', 'Bosch Professional', 'DeWALT', 'HiKOKI', 'Makita'],
        baseUrl: 'https://www.mitre10.co.nz',
        apiUrl: 'https://cq00o09oxx-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=edc61cb5be5216c9cc02459f13e33729&x-algolia-application-id=CQ00O09OXX'
    },
    placemakers: {
        name: 'Placemakers',
        brands: ['HiKOKI', 'Makita', 'Milwaukee', 'DEWALT', 'DeWalt', 'Paslode', 'Nilfisk', 'Bosch', 'HIKOKI'],
        baseUrl: 'https://www.placemakers.co.nz'
    },
    sydneytools: {
        name: 'Sydney Tools',
        brands: ['Milwaukee', 'DEWALT', 'Makita', 'Bosch', 'HiKOKI', 'Festool', 'Metabo', 'Paslode'],
        baseUrl: 'https://sydneytools.co.nz',
        apiUrl: 'https://sydneytools.co.nz/graphql'
    },
    toolshed: {
        name: 'The Tool Shed',
        brands: ['DEWALT', 'Milwaukee', 'Makita', 'HiKOKI', 'Metabo'],
        baseUrl: 'https://www.thetoolshed.co.nz'
    }
};

// Generic pagination helper
async function paginatedFetch(storeName, fetchPageFn) {
    console.error(`[${storeName}] Fetching ${storeName} data...`);
    
    let page = storeName.toLowerCase() === 'bunnings' ? 1 : 0; // Bunnings starts at 1, others at 0
    let totalItems = 0;
    const tools = [];
    
    while (true) {
        console.error(`[${storeName}] Fetching ${storeName} page ${page}...`);
        
        try {
            const { pageTools, hasMore } = await fetchPageFn(page);
            
            if (pageTools.length === 0) {
                console.error(`[${storeName}] No valid products found on page ${page}`);
                break;
            }
            
            tools.push(...pageTools);
            totalItems += pageTools.length;
            console.error(`[${storeName}] Page ${page}: ${pageTools.length} items (total: ${totalItems})`);
            
            if (!hasMore) {
                console.error(`[${storeName}] Reached last page (${page})`);
                break;
            }
            
            page++;
            await sleep(500);
            
        } catch (error) {
            console.error(`[${storeName}] Error fetching page ${page}:`, error.message);
            break;
        }
    }
    
    console.error(`[${storeName}] ${storeName} complete: ${totalItems} items`);
    return tools;
}

// Fetch Bunnings data
async function fetchBunnings(fetchDetails = false) {
    const config = STORE_CONFIG.bunnings;
    // Build URL parameters programmatically
    const brandParam = encodeURIComponent(config.brands.join('|'));
    const categoryParam = encodeURIComponent('Power+Tools--power-tools--L2');
    
    const baseUrl = `${config.baseUrl}/search/products?brandname=${brandParam}&sort=NameAscending&pageSize=36&supercategories=${categoryParam}`;
    console.error(`[Bunnings] Base URL: ${baseUrl}`);
    // Fetch function for Bunnings pages
    async function fetchBunningsPage(page) {
        const url = `${baseUrl}&page=${page}`;
        const response = await fetchWithRetry(url);
        const htmlContent = await response.text();
        
        if (!htmlContent) {
            console.error(`[Bunnings] No content received for page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const dom = new JSDOM(htmlContent);
        const nextDataScript = dom.window.document.querySelector('#__NEXT_DATA__');

        
        if (!nextDataScript) {
            console.error(`[Bunnings] No __NEXT_DATA__ found on page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const jsonData = JSON.parse(nextDataScript.textContent);
        const results = jsonData?.props?.pageProps?.initialState?.global?.searchResults?.data?.results;
        
        if (!results || results.length === 0) {
            console.error(`[Bunnings] No more results found at page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const pageTools = [];
        
        for (const result of results) {
            const brand = result.raw?.brandname || '';
            const name = result.title || result.Title || '';
            const price = result.raw?.price || '';
            const productUrl = result.raw?.productroutingurl || '';
            const fullUrl = productUrl ? `${config.baseUrl}${productUrl}` : '';
            
            let toolData = createToolJson(brand, name, '', price, '', fullUrl, 'bunnings');
            
            // Fetch product details if requested
            if (fetchDetails && fullUrl) {
                console.error(`[Bunnings] Fetching details for: ${name}`);
                try {
                    const detailResponse = await fetchWithRetry(fullUrl);
                    const detailHtml = await detailResponse.text();
                    toolData = parseBunningsProduct(detailHtml, toolData);
                    await sleep(500); // Rate limiting
                } catch (error) {
                    console.error(`[Bunnings] Error fetching details for ${name}: ${error.message}`);
                }
            }
            
            pageTools.push(toolData);
        }
        
        return { pageTools, hasMore: true };
    }
    
    return paginatedFetch('Bunnings', fetchBunningsPage);
}

// Fetch Mitre10 data
async function fetchMitre10(fetchDetails = false) {
    
    // Fetch function for Mitre10 pages
    async function fetchMitre10Page(page) {
        const config = STORE_CONFIG.mitre10;
        const hitsPerPage = 1000;
        // Build API parameters programmatically
        const brandFilters = config.brands.map(brand => `"brandName:${brand}"`).join(',');
        const categoryFilter = '"categoryPath.lvl0:Power Tools"';
        
        const facetFilters = `[[${brandFilters}],[${categoryFilter}]]`;
        const attributesToRetrieve = '["*","-clickAndCollect","-homeDelivery","-clickAndCollectMessage","-storesWithStock","-homeDeliveryMessage"]';
        
        const params = new URLSearchParams({
            facetFilters: facetFilters,
            attributesToRetrieve: attributesToRetrieve,
            hitsPerPage: hitsPerPage.toString(),
            page: page.toString()
        }).toString();
        
        const apiData = {
            requests: [{
                indexName: "retail_products_relevance",
                params: params
            }]
        };
        
        const response = await fetchWithRetry(config.apiUrl, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: JSON.stringify(apiData)
        });
        
        const apiResponse = await response.json();
        
        const hitsOnPage = apiResponse?.results?.[0]?.hits?.length || 0;
        const nbPages = apiResponse?.results?.[0]?.nbPages || 0;
        
        if (hitsOnPage === 0) {
            console.error(`[Mitre10] No more results found at page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const pageTools = [];
        
        for (const result of apiResponse.results[0].hits) {
            const brand = result.brandName || '';
            const name = result.name || '';
            const priceRrp = result.prices?.nationalRRP || '';
            const pricePromo = result.prices?.nationalPromo || '';
            const productUrl = result.url || '';
            const fullUrl = productUrl ? `${config.baseUrl}${productUrl}` : '';
            
            let toolData = createToolJson(brand, name, '', priceRrp, pricePromo, fullUrl, 'mitre10');
            
            // Fetch product details if requested
            if (fetchDetails && fullUrl) {
                console.error(`[Mitre10] Fetching details for: ${name}`);
                try {
                    const detailResponse = await fetchWithRetry(fullUrl);
                    const detailHtml = await detailResponse.text();
                    toolData = parseMitre10Product(detailHtml, toolData);
                    await sleep(500); // Rate limiting
                } catch (error) {
                    console.error(`[Mitre10] Error fetching details for ${name}: ${error.message}`);
                }
            }
            
            pageTools.push(toolData);
        }
        
        return { pageTools, hasMore: page < nbPages - 1 };
    }
    
    return paginatedFetch('Mitre10', fetchMitre10Page);
}

// Fetch Placemakers data
async function fetchPlacemakers(fetchDetails = false) {
    const config = STORE_CONFIG.placemakers;
    // Build URL parameters programmatically
    const brandParams = config.brands.map(brand => `brand:${brand}`).join(':');
    
    const queryParams = new URLSearchParams({
        q: `:title+asc:category:RWCO1:${brandParams}`
    });
    
    const baseUrl = `${config.baseUrl}/online/tools/c/RCC3?${queryParams.toString()}`;

    // Fetch function for Placemakers pages
    async function fetchPlacemakersPage(page) {
        const url = `${baseUrl}&page=${page}`;
        const response = await fetchWithRetry(url);
        const htmlContent = await response.text();
        
        if (!htmlContent) {
            console.error(`[Placemakers] No content received for page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const dom = new JSDOM(htmlContent);
        const document = dom.window.document;
        const productItems = document.querySelectorAll('div.product-item');
        
        if (productItems.length === 0) {
            console.error(`[Placemakers] No products found on page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const pageTools = [];
        
        for (const item of productItems) {
            const brandElement = item.querySelector('div.manufacturer');
            const nameElement = item.querySelector('a.name');
            const partCodeElement = item.querySelector('div.partCode');
            const priceElement = item.querySelector('div.price.bottomSpace') || 
                               item.querySelector('button[data-product-price]') || 
                               item.querySelector('input.productPostPrice');
            
            const brand = brandElement?.textContent?.trim() || '';
            const name = nameElement?.textContent?.trim() || '';
            const url = nameElement?.href || '';
            const partCode = partCodeElement?.textContent?.replace('Part Code: ', '').trim() || '';
            const price = extractPlacemakersPrice(priceElement);
            
            let toolData = createToolJson(brand, name, partCode, price, '', url, 'placemakers');
            
            // Note: Placemakers detail fetching is skipped in the original code
            // but we'll keep the structure consistent for potential future use
            if (fetchDetails && url && !url.includes('placemakers.co.nz')) {
                console.error(`[Placemakers] Fetching details for: ${name}`);
                try {
                    // Placeholder for future Placemakers detail fetching
                    console.error(`[Placemakers] Skipping detail fetch for Placemakers`);
                } catch (error) {
                    console.error(`[Placemakers] Error fetching details for ${name}: ${error.message}`);
                }
            }
            
            pageTools.push(toolData);
        }
        
        return { pageTools, hasMore: true };
    }
    
    return paginatedFetch('Placemakers', fetchPlacemakersPage);
}

// Fetch Sydney Tools data
async function fetchSydneyTools(fetchDetails = false) {
    const config = STORE_CONFIG.sydneytools;
    
    // Helper function to make GraphQL requests
    async function makeGraphQLRequest(query, variables) {
        const response = await fetchWithRetry(config.apiUrl, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json',
                'Origin': 'https://sydneytools.co.nz',
                'Referer': 'https://sydneytools.co.nz/category/by-brand',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
            },
            body: JSON.stringify({ query, variables })
        });
        
        const apiResponse = await response.json();
        
        if (apiResponse.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(apiResponse.errors)}`);
        }
        
        return apiResponse.data;
    }
    
    // Get subcategories for a brand
    async function getSubcategories(brandSlug) {
        const data = await makeGraphQLRequest(GET_CATEGORIES_QUERY, { brandUrlSlug: brandSlug });
        const catalogues = data?.viewer?.categories?.edges?.[0]?.node?.catalogues;
        
        if (!catalogues) {
            return [];
        }
        
        return catalogues.edges
            .filter(edge => edge.node.__typename === 'Subcategory')
            .map(edge => edge.node);
    }
    
    // Get products for a brand and subcategory
    async function getProducts(brandSlug, subcategorySlug) {
        const products = [];
        let cursor = null;
        let hasNextPage = true;
        
        while (hasNextPage) {
            const data = await makeGraphQLRequest(GET_PRODUCTS_QUERY, {
                brandUrlSlug: brandSlug,
                subcategoryUrlSlug: subcategorySlug,
                count: 100,
                cursor: cursor
            });
            
            const catalogues = data?.viewer?.categories?.edges?.[0]?.node?.catalogues;
            
            if (!catalogues) {
                break;
            }
            
            const productEdges = catalogues.edges.filter(edge => edge.node.__typename === 'Product');
            
            for (const edge of productEdges) {
                const product = edge.node;
                const productBrand = product.brand?.name || '';
                const name = product.name || '';
                const modelNumber = product.model || product.secondModel || '';
                const priceRrp = product.regularPrice || '';
                const pricePromo = product.price || '';
                const sku = product.sku || '';
                const urlSlug = product.urlSlug || '';
                const fullUrl = urlSlug ? `${config.baseUrl}/product/${urlSlug}` : '';
                
                let toolData = createToolJson(productBrand, name, modelNumber, priceRrp, pricePromo, fullUrl, 'sydneytools');
                
                // Add SKU to the tool data if available
                if (sku) {
                    toolData.sku = sku;
                }
                
                products.push(toolData);
            }
            
            hasNextPage = catalogues.pageInfo.hasNextPage;
            cursor = catalogues.pageInfo.endCursor;
            
            // Rate limiting
            await sleep(200);
        }
        
        return products;
    }
    
    // Fetch all tools for all configured brands
    const allTools = [];
    
    for (const brand of config.brands) {
        const brandSlug = brand.toLowerCase();
        console.error(`[Sydney Tools] Fetching ${brand} tools...`);
        
        try {
            // Get subcategories for this brand
            const subcategories = await getSubcategories(brandSlug);
            console.error(`[Sydney Tools] Found ${subcategories.length} subcategories for ${brand}`);
            
            // Get products from each subcategory
            for (const subcategory of subcategories) {
                console.error(`[Sydney Tools] Fetching products from ${subcategory.name} (${subcategory.docCount} products)`);
                
                try {
                    const products = await getProducts(brandSlug, subcategory.urlSlug);
                    allTools.push(...products);
                    console.error(`[Sydney Tools] Retrieved ${products.length} products from ${subcategory.name}`);
                } catch (error) {
                    console.error(`[Sydney Tools] Error fetching products from ${subcategory.name}:`, error.message);
                }
                
                // Rate limiting between subcategories
                await sleep(500);
            }
            
            console.error(`[Sydney Tools] Completed ${brand}: ${allTools.length} total tools so far`);
        } catch (error) {
            console.error(`[Sydney Tools] Error fetching ${brand} tools:`, error.message);
        }
        
        // Rate limiting between brands
        await sleep(1000);
    }
    
    return allTools;
}

// Fetch The Tool Shed data
async function fetchToolShed(fetchDetails = false) {
    const config = STORE_CONFIG.toolshed;
    
    // First, get all categories from the power tools section
    async function getCategories() {
        const url = `${config.baseUrl}/category/1186-power-tools`;
        const response = await fetchWithRetry(url);
        const htmlContent = await response.text();
        
        const dom = new JSDOM(htmlContent);
        const document = dom.window.document;
        
        const categoryLinks = document.querySelectorAll('#body .categories.level_1 .category.level_1 .name a');
        const categories = [];
        
        for (const link of categoryLinks) {
            const href = link.getAttribute('href');
            const name = link.textContent.trim();
            if (href && name) {
                categories.push({
                    name: name,
                    url: href.startsWith('http') ? href : `${config.baseUrl}${href}`
                });
            }
        }
        
        console.error(`[Tool Shed] Found ${categories.length} categories`);
        return categories;
    }
    
    // Fetch products from a category page
    async function fetchCategoryProducts(categoryUrl, categoryName) {
        const tools = [];
        let page = 1;
        
        while (true) {
            const url = page === 1 ? categoryUrl : `${categoryUrl}/${page}`;
            console.error(`[Tool Shed] Fetching ${categoryName} page ${page}...`);
            
            try {
                const response = await fetchWithRetry(url);
                const htmlContent = await response.text();
                
                const dom = new JSDOM(htmlContent);
                const document = dom.window.document;
                
                const productElements = document.querySelectorAll('#body .product-groups .product-group');
                
                if (productElements.length === 0) {
                    console.error(`[Tool Shed] No products found on page ${page}`);
                    break;
                }
                
                for (const productElement of productElements) {
                    const nameElement = productElement.querySelector('.name a');
                    const modelElement = productElement.querySelector('.model');
                    const photoElement = productElement.querySelector('.photo a');
                    
                    if (!nameElement || !photoElement) continue;
                    
                    const name = nameElement.textContent.trim();
                    const modelNumber = modelElement ? modelElement.textContent.trim() : '';
                    const productUrl = photoElement.getAttribute('href');
                    const fullUrl = productUrl && productUrl.startsWith('http') ? productUrl : `${config.baseUrl}${productUrl}`;
                    
                    // Extract brand from product name
                    const brand = extractBrandFromName(name);
                    
                    // Skip products that don't match our configured brands
                    if (!brand) {
                        continue;
                    }
                    
                    // Get pricing information
                    let priceRrp = '';
                    let pricePromo = '';
                    
                    const priceOuterSpecial = productElement.querySelector('.price-outer.special');
                    if (priceOuterSpecial) {
                        // Product has a special price
                        const retailValue = priceOuterSpecial.querySelector('.price.retail .retail-value');
                        const specialValue = priceOuterSpecial.querySelector('.price.special .value');
                        
                        if (retailValue) {
                            const retailMatch = retailValue.textContent.match(/\$([0-9,]+\.[0-9]+)/);
                            priceRrp = retailMatch ? retailMatch[1].replace(/,/g, '') : '';
                        }
                        
                        if (specialValue) {
                            const specialMatch = specialValue.textContent.match(/\$([0-9,]+\.[0-9]+)/);
                            pricePromo = specialMatch ? specialMatch[1].replace(/,/g, '') : '';
                        }
                    } else {
                        // Product has standard pricing
                        const standardPrice = productElement.querySelector('.price .value');
                        if (standardPrice) {
                            const priceMatch = standardPrice.textContent.match(/\$([0-9,]+\.[0-9]+)/);
                            priceRrp = priceMatch ? priceMatch[1].replace(/,/g, '') : '';
                        }
                    }
                    
                    const toolData = createToolJson(brand, name, modelNumber, priceRrp, pricePromo, fullUrl, 'toolshed');
                    tools.push(toolData);
                }
                
                console.error(`[Tool Shed] Page ${page}: ${productElements.length} products found`);
                page++;
                
                // Rate limiting
                await sleep(500);
                
            } catch (error) {
                console.error(`[Tool Shed] Error fetching page ${page}:`, error.message);
                break;
            }
        }
        
        return tools;
    }
    
    // Helper function to extract brand from product name
    function extractBrandFromName(name) {
        const nameLower = name.toLowerCase();
        
        // Only check configured brands - return null if not found
        for (const brand of config.brands) {
            if (nameLower.includes(brand.toLowerCase())) {
                return brand;
            }
        }
        
        // Return null if no configured brand is found
        return null;
    }
    
    console.error('[Tool Shed] Fetching The Tool Shed data...');
    
    try {
        const categories = await getCategories();
        const allTools = [];
        
        for (const category of categories) {
            console.error(`[Tool Shed] Processing category: ${category.name}`);
            
            try {
                const categoryTools = await fetchCategoryProducts(category.url, category.name);
                allTools.push(...categoryTools);
                
                console.error(`[Tool Shed] ${category.name}: ${categoryTools.length} tools found`);
                
                // Rate limiting between categories
                await sleep(1000);
                
            } catch (error) {
                console.error(`[Tool Shed] Error processing category ${category.name}:`, error.message);
            }
        }
        
        console.error(`[Tool Shed] The Tool Shed complete: ${allTools.length} items`);
        return allTools;
        
    } catch (error) {
        console.error('[Tool Shed] Error fetching The Tool Shed data:', error.message);
        throw error;
    }
}

// DOM helper functions
const getDomDocument = (htmlContent) => new JSDOM(htmlContent).window.document;

const getNextDataJson = (document) => {
    const script = document.querySelector('#__NEXT_DATA__');
    return script ? JSON.parse(script.textContent) : null;
};

const extractPlacemakersPrice = (priceElement) => {
    if (!priceElement) return '';
    
    if (priceElement.textContent) {
        const priceMatch = priceElement.textContent.match(/\$([0-9,]*\.[0-9]*)/);
        return priceMatch?.[1]?.replace(/,/g, '') || '';
    }
    
    return priceElement.getAttribute('data-product-price') || priceElement.value || '';
};

// Parse Bunnings product page for detailed information
function parseBunningsProduct(htmlContent, originalData) {
    try {
        const document = getDomDocument(htmlContent);
        const jsonData = getNextDataJson(document);
        
        if (!jsonData) {
            console.error(`[Bunnings] Error: No __NEXT_DATA__ script found`);
            return originalData;
        }
        
        const queries = jsonData?.props?.pageProps?.dehydratedState?.queries || [];
        const productQuery = queries.find(query => query.queryKey?.[0] === 'retail-product');
        
        if (!productQuery) {
            console.error(`[Bunnings] Warning: No retail-product query found`);
            return { ...originalData, modelNumber: null };
        }
        
        const features = productQuery.state?.data?.classifications?.[0]?.features || [];
        const modelFeature = features.find(feature => feature.code === 'modelNumber');
        const modelNumber = modelFeature?.featureValues?.[0]?.value || null;
        
        if (!modelNumber) {
            console.error(`[Bunnings] Warning: Model number not found in product data`);
        }
        
        return { ...originalData, modelNumber };
    } catch (error) {
        console.error(`[Bunnings] Error parsing Bunnings product:`, error.message);
        return { ...originalData, modelNumber: null };
    }
}

// Parse Mitre10 product page for detailed information
function parseMitre10Product(htmlContent, originalData) {
    try {
        const document = getDomDocument(htmlContent);
        const modelElements = [...document.querySelectorAll('span.product--model-number')];
        
        const modelElement = modelElements.find(element => 
            element.textContent?.trim().startsWith('MODEL:')
        );
        
        const modelNumber = modelElement
            ? modelElement.textContent.replace('MODEL:', '').trim()
            : null;
        
        if (!modelNumber) {
            console.error(`[Mitre10] Warning: Model number not found in product data`);
        }
        
        return { ...originalData, modelNumber };
    } catch (error) {
        console.error(`[Mitre10] Error parsing Mitre10 product:`, error.message);
        return { ...originalData, modelNumber: null };
    }
}

// Parse Sydney Tools product page for detailed information
function parseSydneyToolsProduct(htmlContent, originalData) {
    try {
        const document = getDomDocument(htmlContent);
        const jsonData = getNextDataJson(document);
        
        if (!jsonData) {
            console.error(`[Sydney Tools] Error: No __NEXT_DATA__ script found`);
            return originalData;
        }
        
        const productData = jsonData?.props?.pageProps?.productData;
        
        if (!productData) {
            console.error(`[Sydney Tools] Warning: No product data found`);
            return originalData;
        }
        
        const modelNumber = productData.modelNumber || null;
        
        if (!modelNumber) {
            console.error(`[Sydney Tools] Warning: Model number not found in product data`);
        }
        
        return { ...originalData, modelNumber };
    } catch (error) {
        console.error(`[Sydney Tools] Error parsing Sydney Tools product:`, error.message);
        return { ...originalData, modelNumber: null };
    }
}

// Store function mapping
const STORE_FETCHERS = new Map([
    ['bunnings', fetchBunnings],
    ['mitre10', fetchMitre10],
    ['placemakers', fetchPlacemakers],
    ['sydneytools', fetchSydneyTools],
    ['toolshed', fetchToolShed]
]);

// Main function
async function main() {
    const args = process.argv.slice(2);
    const store = args[0];
    const fetchDetails = true; // Always fetch details by default
    const sampleSize = args.includes('--sample') ? parseInt(args[args.indexOf('--sample') + 1]) || 10 : null;
    
    if (!store) {
        console.error('Usage: node get-store-data.js <store> [--sample N]');
        console.error(`Available stores: ${[...STORE_FETCHERS.keys()].join(', ')}`);
        console.error('Options:');
        console.error('  --sample N    Process only first N tools (for testing)');
        console.error('');
        console.error('Examples:');
        console.error('  node get-store-data.js bunnings');
        console.error('  node get-store-data.js mitre10');
        console.error('  node get-store-data.js placemakers --sample 5');
        console.error('  node get-store-data.js sydneytools');
        console.error('  node get-store-data.js toolshed');
        process.exit(1);
    }
    
    const fetcherFn = STORE_FETCHERS.get(store);
    if (!fetcherFn) {
        console.error(`Error: Unknown store '${store}'`);
        console.error(`Available stores: ${[...STORE_FETCHERS.keys()].join(', ')}`);
        process.exit(1);
    }
    
    try {
        // Fetch tools with optional details
        let tools = await fetcherFn(fetchDetails);
        
        // Apply sample size limit if specified
        if (sampleSize && tools.length > sampleSize) {
            console.error(`[${STORE_CONFIG[store].name}] Limiting to first ${sampleSize} tools (sample mode)`);
            tools = tools.slice(0, sampleSize);
        }
        
        // Save to file
        const outputFile = path.join(SCRIPT_DATA_DIR, `${store}_tools_detailed${sampleSize ? '_sample' : ''}.json`);
        const outputContent = tools.map(tool => JSON.stringify(tool)).join('\n');
        await fs.writeFile(outputFile, outputContent);
        
        console.error(`[${STORE_CONFIG[store].name}] Data saved to: ${outputFile}`);
        console.error(`[${STORE_CONFIG[store].name}] Total tools: ${tools.length}`);
        
    } catch (error) {
        console.error(`[${store ? STORE_CONFIG[store]?.name || store : 'Unknown'}] Error:`, error.message);
        process.exit(1);
    }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}