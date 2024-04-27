import cors from "cors";
import express from "express";
import routes from "./routes/index.js";
import { init } from "./whatsapp.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/", routes);

app.all("*", (_, res) => {
	return res.status(404).json({ error: "URL not found" });
});

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

(async () => {
	await init();
	app.listen(port, host, () => {
		console.log(`[server]: Server is running at http://${host}:${port}`);
	});
})();
