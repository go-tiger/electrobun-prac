import { Electroview } from "electrobun/view";
import type { LauncherRPCSchema as Schema } from "../shared/rpcSchema";

const rpc = Electroview.defineRPC<Schema>({
	handlers: {
		requests: {},
		messages: {},
	},
});

export const electroview = new Electroview({ rpc });
