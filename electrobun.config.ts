const appName = "react-tailwind-vite";
const version = "0.0.13";

export default {
	// electrobun fields
	app: {
		name: appName,
		identifier: "reacttailwindvite.electrobun.dev",
		version,
	},
	release: {
		baseUrl: "https://github.com/go-tiger/electrobun-prac/releases/latest/download",
	},
	build: {
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: {
			bundleCEF: false,
			icon: "assets/icon.ico",
			productId: "reacttailwindvite.electrobun.dev",
			installDir: appName,
			useAsar: false,
		},
	},
	// electrobun-builder-for-windows fields
	name: appName,
	version,
	author: "go-tiger",
	windows: {
		icon: "assets/icon.ico",
		productId: "reacttailwindvite.electrobun.dev",
		installDir: appName,
	},
};
