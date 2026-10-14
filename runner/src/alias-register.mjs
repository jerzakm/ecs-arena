import { registerHooks } from 'node:module'
import { resolve } from './alias-hook.mjs'

registerHooks({ resolve })
