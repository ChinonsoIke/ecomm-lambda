import { dynamoDB } from "/opt/clients.js";
import { formatResponse } from "/opt/utils.js";
import { ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

export const handler = async (event) => {
  const { httpMethod, path, queryStringParameters, pathParameters } = event;

  if (path === "/products" && httpMethod === "GET") {
    return await getProducts(queryStringParameters);
  }

  if (path.startsWith("/products/") && httpMethod === "GET") {
    return await getProductById(pathParameters?.productId);
  }

  if (path === "/search" && httpMethod === "GET") {
    return await search(queryStringParameters?.searchTerm);
  }

  if (path === "/cats" && httpMethod === "GET") {
    return await getCategories();
  }

  return formatResponse(404, { data: null, error: "Route not found" });
};

async function getProducts(queryParams) {
  const command = new ScanCommand({ TableName: "Products" });
  const result = await dynamoDB.send(command);
  return formatResponse(200, { data: result.Items || [], message: "Products fetched" });
}

async function getProductById(productId) {
  const command = new GetCommand({ TableName: "Products", Key: { id: productId } });
  const result = await dynamoDB.send(command);
  if (!result.Item) return formatResponse(404, { data: null, error: "Product not found" });
  return formatResponse(200, { data: result.Item, message: "Product fetched" });
}

async function search(searchTerm) {
  const command = new ScanCommand({ TableName: "Products" });
  const result = await dynamoDB.send(command);
  const filtered = (result.Items || []).filter(item => 
    item.title?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  return formatResponse(200, { data: filtered, message: "Search completed" });
}

async function getCategories() {
  const command = new ScanCommand({ TableName: "Products", ProjectionExpression: "category" });
  const result = await dynamoDB.send(command);
  const categories = Array.from(new Set((result.Items || []).map(item => item.category).filter(Boolean)));
  return formatResponse(200, { data: categories, message: "Categories fetched" });
}
