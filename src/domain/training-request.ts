import {z} from 'zod';

const id=z.string().uuid();
const rules=z.object({start:z.union([z.literal(301),z.literal(501),z.literal(701)]),out:z.enum(['single','double']),legsToWin:z.number().int().min(1).max(20)});
// Each action validates only the fields it actually uses.
export const trainingRequest=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('create'),rules,mode:z.enum(['x01','around-clock','segments','checkout']).default('x01'),practiceSettings:z.object({segments:z.array(z.number().int().min(1).max(20)).min(1).max(20).refine(a=>new Set(a).size===a.length)}).default({segments:[20]})}),
 z.object({operation:z.literal('start'),id}),
 z.object({operation:z.literal('local'),id,name:z.string().trim().min(1).max(40)}),
 z.object({operation:z.literal('next'),id,rules}),
 z.object({operation:z.literal('delete'),id,expectedVersion:z.number().int().min(1),confirmed:z.literal(true)}),
 z.object({operation:z.literal('remove'),id,participantId:id.optional()}),
]);
