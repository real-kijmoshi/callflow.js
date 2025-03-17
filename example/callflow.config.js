const callflow = require("callflow");

const users = [
  {
    id: "User123",
    username: "awsome callflow user",
    favoriteMovies: ["Star Wars ✨🗡️", "Interstellar 🌒", "Lord of the Rings"],
  },
];

callflow.exposeFunction(
  "HelloWorld", // Function name
  ["messageToServer"], // Arguments
  (req, res, /* your arguments */ messageToServer) => {
    console.log(`Server received message: ${messageToServer}`);

    return "Hello from the server!";
  },
);

callflow.exposeFunction(
  "GetUser", // Function name
  ["userId"], // Arguments
  (req, res, userId) => {
    const user = users.find((user) => user.id === userId);
    if (!user) {
      return "User not found";
    }

    return user;
  },
);

callflow.exposeVariable("HelloWorld", "Hello from the server console!");
