// §4 7c-launches: a shell wrapper whose payload starts a suite product — by its name, or by a path into its package.
declare const spawn: (program: string, args: readonly string[]) => void;

spawn('sh', ['-c', 'exec agent-whatsapp sync --account personal/whatsapp']); // expect: binary, wrapper-payload
export const windows = ['cmd.exe', '/c', 'C:\\npm\\node_modules\\@agentcomms\\core\\dist\\cli.mjs approve ap_1']; // expect: wrapper-payload
