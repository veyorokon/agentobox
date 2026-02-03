export function jsonResult(data: Record<string, unknown>): {content: [{type: 'text'; text: string}]} {
  return {
    content: [{type: 'text' as const, text: JSON.stringify(data, null, 2)}],
  };
}

export function errorResult(message: string): {content: [{type: 'text'; text: string}]; isError: true} {
  return {
    content: [{type: 'text' as const, text: JSON.stringify({error: message})}],
    isError: true,
  };
}