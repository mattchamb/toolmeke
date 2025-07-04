// Query to get categories (subcategories) for a specific brand
export const GET_CATEGORIES_QUERY = `
query GetCategories($brandUrlSlug: String!) {
  viewer {
    categories(first: 1, urlSlug: "by-brand") {
      edges {
        node {
          catalogues(first: 9999, brandUrlSlug: $brandUrlSlug) {
            edges {
              node {
                __typename
                ... on Subcategory {
                  id
                  name
                  urlSlug
                  docCount
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// Query to get products for a specific brand and category
export const GET_PRODUCTS_QUERY = `
query GetProducts($brandUrlSlug: String!, $subcategoryUrlSlug: String!, $count: Int!, $cursor: String) {
  viewer {
    categories(first: 1, urlSlug: "by-brand") {
      edges {
        node {
          catalogues(first: $count, after: $cursor, brandUrlSlug: $brandUrlSlug, subcategoryUrlSlug: $subcategoryUrlSlug) {
            totalCount
            pageInfo {
              endCursor
              hasNextPage
            }
            edges {
              node {
                __typename
                ... on Product {
                  id
                  name
                  model
                  secondModel
                  regularPrice
                  price
                  sku
                  urlSlug
                  brand {
                    id
                    name
                  }
                }
              }
              cursor
            }
          }
        }
      }
    }
  }
}`;
