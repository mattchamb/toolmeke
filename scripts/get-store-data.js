#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';

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
    ['bosch professional', 'Bosch'],
    ['aeg', 'AEG']
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
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
        } catch (error) {
            console.error(`  Attempt ${attempt}/${maxRetries} failed:`, error.message);
            if (attempt === maxRetries) {
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
    }
};

// Generic pagination helper
async function paginatedFetch(storeName, fetchPageFn) {
    console.error(`Fetching ${storeName} data...`);
    
    let page = storeName === 'bunnings' ? 1 : 0; // Bunnings starts at 1, others at 0
    let totalItems = 0;
    const tools = [];
    
    while (true) {
        console.error(`  Fetching ${storeName} page ${page}...`);
        
        try {
            const { pageTools, hasMore } = await fetchPageFn(page);
            
            if (pageTools.length === 0) {
                console.error(`  No valid products found on page ${page}`);
                break;
            }
            
            tools.push(...pageTools);
            totalItems += pageTools.length;
            console.error(`  Page ${page}: ${pageTools.length} items (total: ${totalItems})`);
            
            if (!hasMore) {
                console.error(`  Reached last page (${page})`);
                break;
            }
            
            page++;
            await sleep(500);
            
        } catch (error) {
            console.error(`  Error fetching page ${page}:`, error.message);
            break;
        }
    }
    
    console.error(`${storeName} complete: ${totalItems} items`);
    return tools;
}

// Fetch Bunnings data
async function fetchBunnings(fetchDetails = false) {
    const config = STORE_CONFIG.bunnings;
    // Build URL parameters programmatically
    const brandParam = encodeURIComponent(config.brands.join('|'));
    const categoryParam = encodeURIComponent('Power Tools--power-tools--L2');
    
    const baseUrl = `${config.baseUrl}/search/products?brandname=${brandParam}&sort=NameAscending&pageSize=36&supercategories=${categoryParam}`;
    
    // Fetch function for Bunnings pages
    async function fetchBunningsPage(page) {
        const url = `${baseUrl}&page=${page}`;
        const response = await fetchWithRetry(url);
        const htmlContent = await response.text();
        
        if (!htmlContent) {
            console.error(`  No content received for page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const dom = new JSDOM(htmlContent);
        const nextDataScript = dom.window.document.querySelector('#__NEXT_DATA__');
        
        if (!nextDataScript) {
            console.error(`  No __NEXT_DATA__ found on page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const jsonData = JSON.parse(nextDataScript.textContent);
        const results = jsonData?.props?.pageProps?.initialState?.global?.searchResults?.data?.results;
        
        if (!results || results.length === 0) {
            console.error(`  No more results found at page ${page}`);
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
                console.error(`    Fetching details for: ${name}`);
                try {
                    const detailResponse = await fetchWithRetry(fullUrl);
                    const detailHtml = await detailResponse.text();
                    toolData = parseBunningsProduct(detailHtml, toolData);
                    await sleep(500); // Rate limiting
                } catch (error) {
                    console.error(`    Error fetching details for ${name}: ${error.message}`);
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
            console.error(`  No more results found at page ${page}`);
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
                console.error(`    Fetching details for: ${name}`);
                try {
                    const detailResponse = await fetchWithRetry(fullUrl);
                    const detailHtml = await detailResponse.text();
                    toolData = parseMitre10Product(detailHtml, toolData);
                    await sleep(500); // Rate limiting
                } catch (error) {
                    console.error(`    Error fetching details for ${name}: ${error.message}`);
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
            console.error(`  No content received for page ${page}`);
            return { pageTools: [], hasMore: false };
        }
        
        const dom = new JSDOM(htmlContent);
        const document = dom.window.document;
        const productItems = document.querySelectorAll('div.product-item');
        
        if (productItems.length === 0) {
            console.error(`  No products found on page ${page}`);
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
                console.error(`    Fetching details for: ${name}`);
                try {
                    // Placeholder for future Placemakers detail fetching
                    console.error(`    Skipping detail fetch for Placemakers`);
                } catch (error) {
                    console.error(`    Error fetching details for ${name}: ${error.message}`);
                }
            }
            
            pageTools.push(toolData);
        }
        
        return { pageTools, hasMore: true };
    }
    
    return paginatedFetch('Placemakers', fetchPlacemakersPage);
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
            console.error(`    Error: No __NEXT_DATA__ script found`);
            return originalData;
        }
        
        const queries = jsonData?.props?.pageProps?.dehydratedState?.queries || [];
        const productQuery = queries.find(query => query.queryKey?.[0] === 'retail-product');
        
        if (!productQuery) {
            console.error(`    Warning: No retail-product query found`);
            return { ...originalData, modelNumber: null };
        }
        
        const features = productQuery.state?.data?.classifications?.[0]?.features || [];
        const modelFeature = features.find(feature => feature.code === 'modelNumber');
        const modelNumber = modelFeature?.featureValues?.[0]?.value || null;
        
        if (!modelNumber) {
            console.error(`    Warning: Model number not found in product data`);
        }
        
        return { ...originalData, modelNumber };
    } catch (error) {
        console.error(`    Error parsing Bunnings product:`, error.message);
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
            console.error(`    Warning: Model number not found in product data`);
        }
        
        return { ...originalData, modelNumber };
    } catch (error) {
        console.error(`    Error parsing Mitre10 product:`, error.message);
        return { ...originalData, modelNumber: null };
    }
}

// Store function mapping
const STORE_FETCHERS = new Map([
    ['bunnings', fetchBunnings],
    ['mitre10', fetchMitre10],
    ['placemakers', fetchPlacemakers]
]);

// Main function
async function main() {
    const args = process.argv.slice(2);
    const store = args[0];
    const fetchDetails = args.includes('--details');
    const sampleSize = args.includes('--sample') ? parseInt(args[args.indexOf('--sample') + 1]) || 10 : null;
    
    if (!store) {
        console.error('Usage: node get-store-data.js <store> [--details] [--sample N]');
        console.error(`Available stores: ${[...STORE_FETCHERS.keys()].join(', ')}`);
        console.error('Options:');
        console.error('  --details     Fetch detailed product information (model numbers, etc.)');
        console.error('  --sample N    Process only first N tools (for testing)');
        console.error('');
        console.error('Examples:');
        console.error('  node get-store-data.js bunnings');
        console.error('  node get-store-data.js mitre10 --details');
        console.error('  node get-store-data.js placemakers --details --sample 5');
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
            console.error(`Limiting to first ${sampleSize} tools (sample mode)`);
            tools = tools.slice(0, sampleSize);
        }
        
        // Save to file
        const outputFile = path.join(SCRIPT_DATA_DIR, `${store}_tools${fetchDetails ? '_detailed' : ''}${sampleSize ? '_sample' : ''}.json`);
        const outputContent = tools.map(tool => JSON.stringify(tool)).join('\n');
        await fs.writeFile(outputFile, outputContent);
        
        console.error(`Data saved to: ${outputFile}`);
        console.error(`Total tools: ${tools.length}`);
        
    } catch (error) {
        console.error('Error:', error.message);
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