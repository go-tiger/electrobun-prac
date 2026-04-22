import { Electroview } from "electrobun/view";

const rpc = Electroview.defineRPC({ handlers: { requests: {} } });

export const electroview = new Electroview({ rpc });
