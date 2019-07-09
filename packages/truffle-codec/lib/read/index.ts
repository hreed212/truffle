import * as storage from "./storage";
import * as bytes from "./bytes";
import * as stack from "./stack";
import * as constant from "./constant";
import * as Pointer from "../types/pointer";
import { EvmState } from "../types/evm";
import { DecoderRequest } from "../types/request";
import { Errors } from "truffle-codec-utils";

export default function* read(pointer: Pointer.DataPointer, state: EvmState): IterableIterator<Uint8Array | DecoderRequest> {
  switch(pointer.location) {

    case "stack":
      return stack.readStack(state.stack, pointer.from, pointer.to);

    case "storage":
      return yield* storage.readRange(state.storage, pointer.range);

    case "memory":
      return bytes.readBytes(state.memory, pointer.start, pointer.length);

    case "calldata":
      return bytes.readBytes(state.calldata, pointer.start, pointer.length);

    case "eventdata":
      //similarly with eventdata
      return bytes.readBytes(state.eventdata, pointer.start, pointer.length);

    case "stackliteral":
      return pointer.literal;

    case "definition":
      return constant.readDefinition(pointer.definition);

    case "special":
      //not bothering with error handling on this oen as I don't expect errors
      return state.specials[pointer.special];

    case "eventtopic":
      return readTopic(state.eventtopics, pointer.topic);

    //...and in the case of "abi", which shouldn't happen, we'll just fall off
    //the end and cause a problem :P
  }
}

//this one is simple enough I'm keeping it in the same file
function readTopic(topics: Uint8Array[], index: number) {
  let topic = topics[index];
  if(topic === undefined) {
    throw new Errors.DecodingError(
      new Errors.ReadErrorTopic(index)
    );
  }
  return topic;
}