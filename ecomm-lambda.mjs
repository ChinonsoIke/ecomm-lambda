import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = "us-east-2";
const dynamoDB = new DynamoDBClient({ region: REGION });
let claims = null;

export const handler = async (event) => {
  try {
      claims = event.requestContext?.authorizer?.claims;
      
      const evt = JSON.parse(event.body);
      switch(event.path){
        case("/products"):
            return await getProducts();
        case("/search"):
            return await search(evt.searchTerm);
        case("/carts"):
            if(event.method == "POST") return await addToCart(evt.productId);
            else return await getCart();
        case("/orders"):
            if(event.method == "POST") return await order(evt.productIds);
            else return await getOrders();
        default:
            return await getProducts();
      }
  } catch (error) {
    console.error("Something went wrong:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Something went wrong" }),
    };
  }
}

async function getProducts(){
  try {
    const command = new ScanCommand({
      TableName: "Products",
    });

    const result = await dynamoDB.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify(result.Items),
    };
  } catch (error) {
    console.error("Error scanning table:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to scan table" }),
    };
  }
}

async function search(searchTerm) {
  const command = new ScanCommand({
      TableName: "Products",
      FilterExpression: "contains(title, :val)",
      ExpressionAttributeValues: {
        ":val": searchTerm,
      },
  });
  
  try {
      const result = await dynamoDB.send(command);
      return {
        statusCode: 200,
        body: JSON.stringify(result.Items),
      };
  } catch (err) {
      console.error("Search failed:", err);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Search failed" }),
      };
  }
}

async function getCart() {
    if (!claims) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
    }

    try {
        const getCart = new ScanCommand({
            TableName: "Carts",
            FilterExpression: "userId = :userId",
            ExpressionAttributeValues: {
            ":userId": claims.sub,
            },
        });

        const cartResult = await dynamoDB.send(getCart);
        const cart = cartResult.Items?.[0];
        const id = "";

        if(!cart) {
            id = Date.now().toString(36);
            const createCart = new PutCommand({
                TableName: "Carts",
                Item: {
                    id: id,
                    userId: claims.sub
                }
            });
            await dynamoDB.send(createCart);
        } else id = cart.id
    
        const getCartItems = new ScanCommand({
            TableName: "CartItems",
            FilterExpression: "cartId = :cartId",
            ExpressionAttributeValues: {
            ":cartId": id,
            },
        });
        const cartItemsResult = await dynamoDB.send(getCartItems);
        const response = {
            id: id,
            userId: claims.sub,
            items: cartItemsResult.Items
        }
        
        return {
          statusCode: 200,
          body: JSON.stringify(response)
        };
    } catch (err) {
        console.error("Get cart failed:", err);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Get cart failed" })
        };
    }
}

async function addToCart(productId) {
    if (!claims) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
    }

    //get user cart
    try {
        const getCart = new ScanCommand({
            TableName: "Carts",
            FilterExpression: "userId = :userId",
            ExpressionAttributeValues: {
            ":userId": claims.sub,
            },
        });

        const cartResult = await dynamoDB.send(getCart);
        const cart = cartResult.Items?.[0];
        const id = "";

        if(!cart) {
            id = Date.now().toString(36);
            const createCart = new PutCommand({
                TableName: "Carts",
                Item: {
                    id: id,
                    userId: claims.sub
                }
            });
            await dynamoDB.send(createCart);
        } else id = cart.id
        
        const command = new PutCommand({
            TableName: "CartItems",
            Item: {
            id: Date.now().toString(36),
            cartId: id,
            productId: productId
            }
        });    
    
        const result = await dynamoDB.send(command);
        console.log("Item added to cart:", result);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Item added to cart" })
        };
    } catch (err) {
        console.error("Add to cart failed:", err);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Add to cart failed" })
        };
    }
}

async function getOrders() {
    if (!claims) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
    }

    try {
        const getOrders = new ScanCommand({
            TableName: "Orders",
            FilterExpression: "userId = :userId",
            ExpressionAttributeValues: {
            ":userId": claims.sub,
            },
        });

        const getOrdersResult = await dynamoDB.send(getOrders);
        const response = {
            userId: claims.sub,
            items: getOrdersResult.Items
        }
        
        return {
          statusCode: 200,
          body: JSON.stringify(response)
        };
    } catch (err) {
        console.error("Get orders failed:", err);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Get orders failed" })
        };
    }
}

async function order(productIds) {
    if (!claims) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
    }

    const command = new PutCommand({
        TableName: "Orders",
        Item: {
          id: Date.now().toString(36),
          userId: claims.sub,
          productIds: productIds
        }
    });
    
    try {
        const result = await dynamoDB.send(command);
        console.log("Order placed:", result);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Order placed" })
        };
    } catch (err) {
        console.error("Order failed:", err);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Order failed" })
        };
    }
}