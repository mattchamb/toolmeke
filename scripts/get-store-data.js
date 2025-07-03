#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.dirname(SCRIPT_DIR);
const SCRIPT_DATA_DIR = path.join(SCRIPT_DIR, 'data');

// Ensure data directory exists
if (!fs.existsSync(SCRIPT_DATA_DIR)) {
    fs.mkdirSync(SCRIPT_DATA_DIR, { recursive: true });
}

// Normalize brand names
function normalizeBrand(brand) {
    const normalized = brand.toLowerCase();
    switch (normalized) {
        case 'dewalt': return 'DEWALT';
        case 'milwaukee': return 'Milwaukee';
        case 'hikoki': return 'HiKOKI';
        case 'makita lxt':
        case 'makita xgt': return 'Makita';
        case 'bosch professional': return 'Bosch';
        case 'aeg': return 'AEG';
        default: return brand;
    }
}

// Create standardized tool JSON
function createToolJson(brand, name, modelNumber, priceRrp, pricePromo, url, store) {
    return {
        toolBrand: normalizeBrand(brand),
        name: name,
        modelNumber: modelNumber || '',
        price: {
            rrp: priceRrp && priceRrp !== 'null' ? parseFloat(priceRrp) : null,
            promo: pricePromo && pricePromo !== 'null' ? parseFloat(pricePromo) : null
        },
        url: url,
        store: store
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

// Fetch Bunnings data
async function fetchBunnings() {
    console.error('Fetching Bunnings data...');
    
    // Build URL parameters programmatically
    const brands = ['DEWALT', 'Bosch Professional', 'Makita', 'AEG', 'Makita LXT', 'Makita XGT', 'Paslode'];
    const brandParam = encodeURIComponent(brands.join('|'));
    const categoryParam = encodeURIComponent('Power Tools--power-tools--L2');
    
    const baseUrl = `https://www.bunnings.co.nz/search/products?brandname=${brandParam}&sort=NameAscending&pageSize=36&supercategories=${categoryParam}`;
    let page = 1;
    let totalItems = 0;
    const tools = [];
    
    while (true) {
        console.error(`  Fetching Bunnings page ${page}...`);
        
        try {
            const url = `${baseUrl}&page=${page}`;
            const response = await fetchWithRetry(url);
            const htmlContent = await response.text();
            
            if (!htmlContent) {
                console.error(`  No content received for page ${page}`);
                break;
            }
            
            const dom = new JSDOM(htmlContent);
            const nextDataScript = dom.window.document.querySelector('#__NEXT_DATA__');
            
            if (!nextDataScript) {
                console.error(`  No __NEXT_DATA__ found on page ${page}`);
                break;
            }
            
            const jsonData = JSON.parse(nextDataScript.textContent);
            const results = jsonData?.props?.pageProps?.initialState?.global?.searchResults?.data?.results;
            
            if (!results || results.length === 0) {
                console.error(`  No more results found at page ${page}`);
                break;
            }
            
            let pageCount = 0;
            for (const result of results) {
                const brand = result.raw?.brandname || '';
                const name = result.title || result.Title || '';
                const price = result.raw?.price || '';
                const productUrl = result.raw?.productroutingurl || '';
                const fullUrl = productUrl ? `https://www.bunnings.co.nz${productUrl}` : '';
                
                if (name && brand) {
                    tools.push(createToolJson(brand, name, '', price, '', fullUrl, 'bunnings'));
                    pageCount++;
                }
            }
            
            if (pageCount === 0) {
                console.error(`  No valid products found on page ${page}`);
                break;
            }
            
            totalItems += pageCount;
            console.error(`  Page ${page}: ${pageCount} items (total: ${totalItems})`);
            page++;
            await sleep(1000);
            
        } catch (error) {
            console.error(`  Error fetching page ${page}:`, error.message);
            break;
        }
    }
    
    console.error(`Bunnings complete: ${totalItems} items`);
    return tools;
}

// Fetch Mitre10 data
async function fetchMitre10() {
    console.error('Fetching Mitre10 data...');
    
    let page = 0;
    let totalItems = 0;
    const hitsPerPage = 1000;
    const tools = [];
    
    while (true) {
        console.error(`  Fetching Mitre10 page ${page}...`);
        
        try {
            // Build API parameters programmatically
            const brands = ['Bosch', 'Bosch Professional', 'DeWALT', 'HiKOKI', 'Makita'];
            const brandFilters = brands.map(brand => `"brandName:${brand}"`).join(',');
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
            
            const response = await fetchWithRetry('https://cq00o09oxx-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=edc61cb5be5216c9cc02459f13e33729&x-algolia-application-id=CQ00O09OXX', {
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
                break;
            }
            
            let pageCount = 0;
            for (const result of apiResponse.results[0].hits) {
                const brand = result.brandName || '';
                const name = result.name || '';
                const priceRrp = result.prices?.nationalRRP || '';
                const pricePromo = result.prices?.nationalPromo || '';
                const productUrl = result.url || '';
                const fullUrl = productUrl ? `https://www.mitre10.co.nz${productUrl}` : '';
                
                if (name && brand) {
                    tools.push(createToolJson(brand, name, '', priceRrp, pricePromo, fullUrl, 'mitre10'));
                    pageCount++;
                }
            }
            
            totalItems += pageCount;
            console.error(`  Page ${page}: ${pageCount} items (total: ${totalItems})`);
            
            if (page >= nbPages - 1) {
                console.error(`  Reached last page (${page})`);
                break;
            }
            
            page++;
            await sleep(1000);
            
        } catch (error) {
            console.error(`  Error fetching page ${page}:`, error.message);
            break;
        }
    }
    
    console.error(`Mitre10 complete: ${totalItems} items`);
    return tools;
}

// Fetch Placemakers data
async function fetchPlacemakers() {
    console.error('Fetching Placemakers data...');
    
    // Build URL parameters programmatically
    const brands = ['HiKOKI', 'Makita', 'Milwaukee', 'DEWALT', 'DeWalt', 'Paslode', 'Nilfisk', 'Bosch', 'HIKOKI'];
    const brandParams = brands.map(brand => `brand:${brand}`).join(':');
    
    const queryParams = new URLSearchParams({
        q: `:title+asc:category:RWCO1:${brandParams}`
    });
    
    const baseUrl = `https://www.placemakers.co.nz/online/tools/c/RCC3?${queryParams.toString()}`;
    let page = 0;
    let totalItems = 0;
    const tools = [];
    
    while (true) {
        console.error(`  Fetching Placemakers page ${page}...`);
        
        try {
            const url = `${baseUrl}&page=${page}`;
            const response = await fetchWithRetry(url);
            const htmlContent = await response.text();
            
            if (!htmlContent) {
                console.error(`  No content received for page ${page}`);
                break;
            }
            
            const dom = new JSDOM(htmlContent);
            const document = dom.window.document;
            const productItems = document.querySelectorAll('div.product-item');
            
            if (productItems.length === 0) {
                console.error(`  No products found on page ${page}`);
                break;
            }
            
            let pageCount = 0;
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
                
                let price = '';
                if (priceElement) {
                    if (priceElement.textContent) {
                        const priceMatch = priceElement.textContent.match(/\$([0-9,]*\.[0-9]*)/);
                        price = priceMatch ? priceMatch[1].replace(/,/g, '') : '';
                    } else if (priceElement.getAttribute('data-product-price')) {
                        price = priceElement.getAttribute('data-product-price');
                    } else if (priceElement.value) {
                        price = priceElement.value;
                    }
                }
                
                if (brand && name) {
                    tools.push(createToolJson(brand, name, partCode, price, '', url, 'placemakers'));
                    pageCount++;
                }
            }
            
            if (pageCount === 0) {
                console.error(`  No valid products found on page ${page}`);
                break;
            }
            
            totalItems += pageCount;
            console.error(`  Page ${page}: ${pageCount} items (total: ${totalItems})`);
            page++;
            await sleep(1000);
            
        } catch (error) {
            console.error(`  Error fetching page ${page}:`, error.message);
            break;
        }
    }
    
    console.error(`Placemakers complete: ${totalItems} items`);
    return tools;
}

// Parse Bunnings product page for detailed information
function parseBunningsProduct(htmlContent, originalData) {
    try {
        const dom = new JSDOM(htmlContent);
        const nextDataScript = dom.window.document.querySelector('#__NEXT_DATA__');
        
        if (!nextDataScript) {
            console.error(`    Error: No __NEXT_DATA__ script found`);
            return originalData;
        }
        
        const jsonData = JSON.parse(nextDataScript.textContent);
        const queries = jsonData?.props?.pageProps?.dehydratedState?.queries || [];
        
        let modelNumber = '';
        for (const query of queries) {
            if (query.queryKey?.[0] === 'retail-product') {
                const features = query.state?.data?.classifications?.[0]?.features || [];
                for (const feature of features) {
                    if (feature.code === 'modelNumber') {
                        modelNumber = feature.featureValues?.[0]?.value || '';
                        break;
                    }
                }
                break;
            }
        }
        
        if (!modelNumber) {
            console.error(`    Warning: Model number not found in product data`);
        }
        
        return { ...originalData, modelNumber: modelNumber || null };
    } catch (error) {
        console.error(`    Error parsing Bunnings product:`, error.message);
        return { ...originalData, modelNumber: null };
    }
}

// Parse Mitre10 product page for detailed information
function parseMitre10Product(htmlContent, originalData) {
    try {
        const dom = new JSDOM(htmlContent);
        const document = dom.window.document;
        const modelElements = document.querySelectorAll('span.product--model-number');
        
        let modelNumber = '';
        for (const element of modelElements) {
            const text = element.textContent?.trim() || '';
            if (text.startsWith('MODEL:')) {
                modelNumber = text.replace('MODEL:', '').trim();
                break;
            }
        }
        
        if (!modelNumber) {
            console.error(`    Warning: Model number not found in product data`);
        }
        
        return { ...originalData, modelNumber: modelNumber || null };
    } catch (error) {
        console.error(`    Error parsing Mitre10 product:`, error.message);
        return { ...originalData, modelNumber: null };
    }
}

// Fetch product details for a single tool
async function fetchProductDetails(toolData) {
    const { store, url, name } = toolData;
    
    console.error(`Fetching details for: ${name} (${store})`);
    console.error(`  URL: ${url}`);
    
    // Skip fetching for placemakers.co.nz
    if (url.includes('placemakers.co.nz')) {
        console.error('  Skipping fetch for placemakers.co.nz');
        return toolData;
    }
    
    try {
        const response = await fetchWithRetry(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });
        
        const htmlContent = await response.text();
        
        if (!htmlContent) {
            console.error('  Error: No content received');
            return { ...toolData, modelNumber: null };
        }
        
        // Parse based on store type
        switch (store) {
            case 'bunnings':
                return parseBunningsProduct(htmlContent, toolData);
            case 'mitre10':
                return parseMitre10Product(htmlContent, toolData);
            default:
                console.error(`  Warning: Unknown store type '${store}'`);
                return toolData;
        }
        
    } catch (error) {
        console.error(`  Error: Failed to fetch URL - ${error.message}`);
        return { ...toolData, modelNumber: null };
    }
}

// Process tools to fetch detailed information
async function processToolsForDetails(tools, sampleSize = null) {
    const toolsToProcess = sampleSize ? tools.slice(0, sampleSize) : tools;
    const totalTools = toolsToProcess.length;
    
    console.error(`Processing ${totalTools} tools for detailed information...`);
    
    const detailedTools = [];
    let successful = 0;
    let failed = 0;
    
    for (let i = 0; i < toolsToProcess.length; i++) {
        const tool = toolsToProcess[i];
        console.error(`\n=== Processing tool ${i + 1} of ${totalTools} ===`);
        
        try {
            const result = await fetchProductDetails(tool);
            detailedTools.push(result);
            successful++;
        } catch (error) {
            console.error(`  Error: Failed to process tool - ${error.message}`);
            detailedTools.push(tool);
            failed++;
        }
        
        console.error(`  Progress: ${i + 1}/${totalTools} (successful: ${successful}, failed: ${failed})`);
        
        // Add a small delay to be respectful to the servers
        if (i < toolsToProcess.length - 1) {
            await sleep(1000);
        }
    }
    
    console.error(`\n=== Processing Complete ===`);
    console.error(`Total processed: ${totalTools}`);
    console.error(`Successful: ${successful}`);
    console.error(`Failed/Skipped: ${failed}`);
    
    return detailedTools;
}

// Main function
async function main() {
    const args = process.argv.slice(2);
    const store = args[0];
    const fetchDetails = args.includes('--details');
    const sampleSize = args.includes('--sample') ? parseInt(args[args.indexOf('--sample') + 1]) || 10 : null;
    
    if (!store) {
        console.error('Usage: node get-store-data.js <store> [--details] [--sample N]');
        console.error('Available stores: bunnings, mitre10, placemakers');
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
    
    let tools = [];
    
    try {
        switch (store) {
            case 'bunnings':
                tools = await fetchBunnings();
                break;
            case 'mitre10':
                tools = await fetchMitre10();
                break;
            case 'placemakers':
                tools = await fetchPlacemakers();
                break;
            default:
                console.error(`Error: Unknown store '${store}'`);
                console.error('Available stores: bunnings, mitre10, placemakers');
                process.exit(1);
        }
        
        // Apply sample size limit if specified (before detailed fetching)
        if (sampleSize && tools.length > sampleSize) {
            console.error(`Limiting to first ${sampleSize} tools (sample mode)`);
            tools = tools.slice(0, sampleSize);
        }
        
        // Fetch detailed information if requested
        if (fetchDetails && tools.length > 0) {
            tools = await processToolsForDetails(tools);
        }
        
        // Save to file
        const outputFile = path.join(SCRIPT_DATA_DIR, `${store}_tools${fetchDetails ? '_detailed' : ''}${sampleSize ? '_sample' : ''}.json`);
        const outputContent = tools.map(tool => JSON.stringify(tool)).join('\n');
        fs.writeFileSync(outputFile, outputContent);
        
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