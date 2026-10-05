// §4 7c: a result's field of a name nobody has listed yet carries a suite command by its bare name.
export function report(approvalId: string) {
  return { approvalId, brandNewField: `agent-gmail approve ${approvalId}` }; // expect: binary
}
