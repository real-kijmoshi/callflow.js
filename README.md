# CallFlow

CallFlow is a lightweight, file-based routing framework for Node.js applications that makes it easy to build server-rendered web applications with minimal configuration.

## Features

- **File-based routing system** - Create routes by simply adding files to the `pages` directory
- **Layouts support** - Wrap pages in reusable layouts with `_layout.html` files
- **Middleware support** - Add custom middleware at any level of your route hierarchy
- **Dynamic routes** - Create dynamic routes with parameters using `[paramName]` folder naming
- **Organization folders** - Group related files with parentheses folders `(folderName)`
- **Hot reloading** - Automatically reload changes during development
- **Exposed functions and variables** - Easily expose server-side functions and variables to the client
- **Production-ready** - Optimized for both development and production environments

## Installation

```bash
npm install callflow.js
```

## Quick Start

1. Initialize a new project:

```bash
npx callflow.js init
```

2. Start the development server:

```bash
npx callflow.js dev
```

3. Start the production server:

```bash
npx callflow.js start
```

## Project Structure

```
my-callflow-app/
├── pages/
│   ├── index.html           # Home page (/)
│   ├── _layout.html         # Root layout
│   ├── middleware.js        # Root middleware
│   ├── 404.html             # Custom 404 page
│   ├── about/
│   │   ├── index.html       # About page (/about)
│   │   └── _layout.html     # Layout for about pages
│   ├── blog/
│   │   ├── [slug]/          # Dynamic route
│   │   │   ├── index.html   # Blog post page (/blog/any-slug)
│   │   │   └── middleware.js # Middleware for specific blog posts
│   │   └── index.html       # Blog index page (/blog)
│   └── (admin)/             # Organization folder (not part of the URL)
│       └── index.html       # Admin page accessible at /
├── package.json
└── callflow.config.js       # CallFlow configuration
```

## Routing

CallFlow uses a file-based routing system similar to Next.js:

- `pages/index.html` → `/`
- `pages/about.html` → `/about`
- `pages/about/index.html` → `/about`
- `pages/blog/[slug]/index.html` → `/blog/:slug`

### Dynamic Routes

Create dynamic routes by using folders with square brackets:

```
pages/users/[id]/index.html → /users/:id
```

Inside your HTML files, you can access the parameter with `{id}`:

```html
<h1>User Profile for {id}</h1>
```

### Organization Folders

Folders wrapped in parentheses are not included in the URL path:

```
pages/(admin)/dashboard.html → /dashboard
```

## Layouts

Create layouts to reuse common UI elements across pages:

```html
<!-- pages/_layout.html -->
<!doctype html>
<html>
  <head>
    <title>My CallFlow App</title>
  </head>
  <body>
    <header>Common Header</header>
    <%content%>
    <footer>Common Footer</footer>
  </body>
</html>
```

The `<%content%>` placeholder will be replaced with the content of the page.

## Middleware

Add middleware to handle requests at different levels of your route hierarchy:

```javascript
// pages/middleware.js
module.exports = function (req, res) {
  // This middleware runs for all routes
  console.log("Request received:", req.path);

  // Optional: end the request early
  if (!req.headers.authorization) {
    res.status(401).send("Unauthorized");
    return;
  }

  // Continue to the next middleware or page handler
};
```

## Configuration

Configure your CallFlow application in `callflow.config.js`:

```javascript
const callflow = require("callflow.js");

// Expose server-side functions to the client
callflow.exposeFunction(
  "getCurrentUser",
  [{ name: "userId", type: "string" }],
  async function (req, res, userId) {
    // Fetch user data from database
    return { id: userId, name: "John Doe" };
  },
);

// Expose variables to the client
callflow.exposeVariable("apiVersion", "1.0.0");
```

Access exposed functions and variables in the browser:

```html
<script>
  // Access exposed functions
  callflow.fn.getCurrentUser("123").then((user) => {
    console.log("Current user:", user);
  });

  // Access exposed variables
  console.log("API Version:", callflow.vars.apiVersion);
</script>
```

## CLI Commands

CallFlow provides a CLI with the following commands:

- `callflow init` - Initialize a new project
- `callflow dev` - Start the development server
- `callflow start` - Start the production server

## Development vs Production

- **Development**: Hot reloading is enabled, and caching is disabled
- **Production**: Optimized for performance with caching enabled

## current issues

### MAJOR

- [x] all \_layout.html files are being renderd - fixed in 0.9.2
- [x] all middleware.js files are being renderd - fixed in 0.9.2

### MINOR

- [x] name.html is not renderd insted need to use /name/index.html - fixed in 0.9.2
- [x] [slug].html is not renderd insted need to use /slug/index.html - fixed in 0.9.2
- [x] (folder) may not work as expected - fixed in 0.9.2

## future features

- [ ] authentication - expected in v1.0.0
- [ ] database connection - expected in v1.0.0
- [ ] custom plugins - expected in v1.0.0
- [ ] file upload - expected in v1.1.0
- [ ] file download - expected in v1.1.0
- [ ] tailwindcss support - expected in v1.1.0
- [ ] live variables (via tcp for things like counters) - expected in v1.2.0
- [ ] live functions (via tcp for things like chat) - expected in v1.2.0

## current version

- 0.9.3


### new features

x

## License

MIT
