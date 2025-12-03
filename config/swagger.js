import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "QA Portal API",
      version: "1.0.0",
      description:
        "API documentation for QA Portal - Interview/Test Management System",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url:
          process.env.API_URL ||
          (process.env.NODE_ENV === "production"
            ? ""
            : "http://localhost:8080"),
        description: "Current server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter JWT token",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "jid",
          description: "Refresh token stored in httpOnly cookie",
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              description: "User ID",
            },
            name: {
              type: "string",
              description: "User full name",
            },
            email: {
              type: "string",
              format: "email",
              description: "User email address",
            },
            role: {
              type: "string",
              enum: ["admin", "staff", "student"],
              description: "User role",
            },
            isActive: {
              type: "boolean",
              description: "Whether the account is active",
            },
            collegeName: {
              type: "string",
              description: "College name (for students)",
            },
            mobileNumber: {
              type: "string",
              description: "Mobile number",
            },
            department: {
              type: "string",
              description: "Department",
            },
            yearOfPassing: {
              type: "number",
              description: "Year of passing",
            },
          },
        },
        Question: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              description: "Question ID",
            },
            title: {
              type: "string",
              description: "Question title",
            },
            description: {
              type: "string",
              description: "Question description/content",
            },
            domain: {
              type: "string",
              description: "Domain ID",
            },
            section: {
              type: "string",
              enum: ["A", "B"],
              description: "Question section",
            },
            difficulty: {
              type: "string",
              enum: ["easy", "medium", "hard"],
              description: "Question difficulty level",
            },
            answerText: {
              type: "string",
              description: "Answer text for the question",
            },
            createdBy: {
              type: "string",
              description: "User ID who created the question",
            },
          },
        },
        Domain: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              description: "Domain ID",
            },
            name: {
              type: "string",
              description: "Domain name",
            },
            description: {
              type: "string",
              description: "Domain description",
            },
            createdBy: {
              type: "string",
              description: "User ID who created the domain",
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Error message",
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ["./routes/*.js", "./server.js"], // Path to the API files
};

const swaggerSpec = swaggerJsdoc(options);

const swaggerSetup = (app) => {
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "QA Portal API Documentation",
      swaggerOptions: {
        url: "/api-docs/swagger.json",
      },
    })
  );

  // Serve the swagger spec with dynamic server URL
  app.get("/api-docs/swagger.json", (req, res) => {
    try {
      let baseUrl;

      // Use environment variable if set, otherwise detect from request
      if (process.env.API_URL) {
        baseUrl = process.env.API_URL;
      } else {
        const protocol = req.protocol || (req.secure ? "https" : "http");
        const host = req.get("host");
        baseUrl = `${protocol}://${host}`;

        // For local development, ensure we use localhost
        if (
          process.env.NODE_ENV !== "production" &&
          host.includes("localhost")
        ) {
          baseUrl = `http://localhost:${process.env.PORT || 8080}`;
        }
      }

      const dynamicSpec = JSON.parse(JSON.stringify(swaggerSpec));
      dynamicSpec.servers = [
        {
          url: baseUrl,
          description:
            process.env.NODE_ENV === "production"
              ? "Production server"
              : "Local server",
        },
      ];

      res.setHeader("Content-Type", "application/json");
      res.json(dynamicSpec);
    } catch (error) {
      res.status(500).json({
        error: "Failed to generate Swagger spec",
        message: error.message,
      });
    }
  });
};

export default swaggerSetup;
