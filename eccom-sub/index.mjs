import { snsClient } from "clients";
import { formatResponse } from "utils";
import { SubscribeCommand } from "@aws-sdk/client-sns";

const SNS_TOPIC_ARN = "arn:aws:sns:us-east-2:576771098782:email-sub";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return formatResponse(200, {});
  }

  try {
    const path = event.rawPath || event.path || "";
    const httpMethod = event.httpMethod || "";

    if (path === "/sub" && httpMethod === "POST") {
      const evt = event.body && event.body !== "" ? JSON.parse(event.body) : {};
      return await subscribeToSNS(evt.email);
    }

    if (path === "/test") {
      return formatResponse(200, { data: { testing: "sub version running" }, message: "Sub test route working" });
    }

    return formatResponse(404, { data: null, error: "Route not found " + path });
  } catch (error) {
    console.error("Unhandled Error:", error);
    return formatResponse(500, { data: null, error: error.message });
  }
};

async function subscribeToSNS(email) {
  if (!email || typeof email !== "string") {
    return formatResponse(400, { data: null, error: "Invalid or missing email" });
  }

  const command = new SubscribeCommand({
    Protocol: "email",
    TopicArn: SNS_TOPIC_ARN,
    Endpoint: email
  });

  try {
    const response = await snsClient.send(command);
    return formatResponse(200, { data: response, message: "Subscription request sent. Please check your email to confirm." });
  } catch (error) {
    console.error("SNS subscription error:", error);
    return formatResponse(500, { data: null, error: "Failed to subscribe email to SNS topic" });
  }
}
