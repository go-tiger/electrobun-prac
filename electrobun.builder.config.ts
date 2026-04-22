import type { ElectrobunConfig } from "electrobun-builder-for-windows";
import { version } from "./package.json";

const config: ElectrobunConfig = {
	name: "react-tailwind-vite",
	version,
	author: "go-tiger",
	windows: {
productId: "reacttailwindvite.electrobun.dev",
		installDir: "react-tailwind-vite",
	},
};

export default config;
