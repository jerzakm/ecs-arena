/** BENCH_WRAP prefixes every timed child command, for example "taskset -c 3" or "chrt -f 99" on a tuned box. */
export const WRAP = (process.env.BENCH_WRAP ?? '').split(' ').filter(Boolean)

/** The executable and node flags that start a child under BENCH_WRAP. Without a wrap, the executable is node itself. */
export const wrapped = (execArgv: string[]): { execPath: string; execArgv: string[] } => {
  const [wrap, ...wrapArgs] = WRAP
  return wrap
    ? { execPath: wrap, execArgv: [...wrapArgs, process.execPath, ...execArgv] }
    : { execPath: process.execPath, execArgv }
}
