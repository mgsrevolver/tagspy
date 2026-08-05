export function finding({ rule, message, evidence = [], suggestion = '', waiveKey }) {
  return { rule, message, evidence, suggestion, waiveKey: waiveKey ?? rule };
}
