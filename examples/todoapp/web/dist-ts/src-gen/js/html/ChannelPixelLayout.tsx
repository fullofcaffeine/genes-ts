import {Register} from "../../genes/Register"

export type ChannelPixelLayout = {
	dataType: "float32" | "float64" | "int16" | "int32" | "int8" | "uint16" | "uint32" | "uint8",
	height: number,
	offset: number,
	skip: number,
	stride: number,
	width: number
}
