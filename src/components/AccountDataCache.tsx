'use client';
import {createContext,useContext,useRef,type ReactNode} from 'react';
type Cache={entries:Map<string,unknown>;latestApp:unknown};
const Context=createContext<Cache|null>(null);
/** Memory only, scoped to the mounted signed-in account. Never shared across logins. */
export default function AccountDataCache({children}:{children:ReactNode}){const cache=useRef<Cache>({entries:new Map(),latestApp:null});return <Context.Provider value={cache.current}>{children}</Context.Provider>;}
export function useAccountDataCache(){return useContext(Context);}
