import { dynamoDB, sesClient } from "clients";
import { formatResponse } from "utils";
import {
  ScanCommand,
  PutCommand,
  GetCommand
} from "@aws-sdk/lib-dynamodb";
import { SendEmailCommand } from "@aws-sdk/client-ses";

let claims = null;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return formatResponse(200, {});
  }

  try {
    claims = event.requestContext?.authorizer?.claims;
    const evt = event.body && event.body !== "" ? JSON.parse(event.body) : {};

    const path = event.rawPath || event.path || "";
    const httpMethod = event.httpMethod || "";

    switch (true) {
      case path === "/orders" && httpMethod === "POST":
        return await order(evt.productIds);
      case path === "/orders" && httpMethod === "GET":
        return await getOrders();
      case path === "/test":
        return formatResponse(200, { data: { testing: "orders version running" }, message: "Orders test route working" });
      default:
        return formatResponse(404, { data: null, error: "Route not found " + path });
    }
  } catch (error) {
    console.error("Unhandled Error:", error);
    return formatResponse(500, { data: null, error: error.message });
  }
};

async function getOrders() {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }
  try {
    const getOrders = new ScanCommand({
      TableName: "Orders",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": claims.sub }
    });
    const getOrdersResult = await dynamoDB.send(getOrders);
    const orders = getOrdersResult.Items || [];

    const ordersWithProducts = await Promise.all(
      orders.map(async (order) => {
        const products = await Promise.all(
          order.productIds.map(async (productId) => {
            const getProduct = new GetCommand({
              TableName: "Products",
              Key: { id: productId }
            });
            const productResult = await dynamoDB.send(getProduct);
            return productResult.Item || null;
          })
        );
        return {
          ...order,
          products: products.filter(Boolean)
        };
      })
    );

    const response = { userId: claims.sub, orders: ordersWithProducts };
    return formatResponse(200, { data: response, message: "Orders fetched successfully" });
  } catch (err) {
    console.error("Get orders failed:", err);
    return formatResponse(500, { data: null, error: "Get orders failed" });
  }
}

async function order(productIds) {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }

  const orderItem = {
    id: Date.now().toString(36),
    userId: claims.sub,
    productIds: productIds,
    orderedAt: new Date().toISOString()
  };

  const command = new PutCommand({
    TableName: "Orders",
    Item: orderItem
  });

  try {
    await dynamoDB.send(command);

    const userEmail = claims.email;
    if (userEmail) {
      await sendOrderConfirmationEmail(orderItem, userEmail);
    }

    return formatResponse(200, { data: orderItem, message: "Order placed successfully" });
  } catch (err) {
    console.error("Order failed:", err);
    return formatResponse(500, { data: null, error: "Order failed" });
  }
}

async function sendOrderConfirmationEmail(orderItem, userEmail) {
  const htmlBody = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
          <div style="text-align: center;">
            <img src="https://yourdomain.com/logo.png" alt="Company Logo" style="max-height: 60px;"/>
          </div>
          <h2 style="color: #4CAF50; text-align: center;">Order Confirmation</h2>
          <p>Hi there,</p>
          <p>Thank you for your purchase! Here are your order details:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">Order ID:</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${orderItem.id}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">Ordered At:</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${orderItem.orderedAt}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">Products:</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${orderItem.productIds.map(pid => `<div>${pid}</div>`).join("")}</td>
            </tr>
          </table>
          <p style="margin-top: 20px;">If you have any questions, feel free to contact our support team.</p>
          <p style="text-align: center; color: #999;">&copy; ${new Date().getFullYear()} Your Company Name</p>
        </div>
      </body>
    </html>
  `;

  const emailParams = {
    Destination: { ToAddresses: [userEmail] },
    Message: {
      Body: { Html: { Data: htmlBody } },
      Subject: { Data: `Order Confirmation - ${orderItem.id}` }
    },
    Source: "contact@anasroud.com"
  };

  try {
    await sesClient.send(new SendEmailCommand(emailParams));
    console.log("Order confirmation email sent!");
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
