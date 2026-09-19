export namespace main {
	
	export class MonitorInfo {
	    index: number;
	    name: string;
	    x: number;
	    y: number;
	    width: number;
	    height: number;
	    isPrimary: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MonitorInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.name = source["name"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.isPrimary = source["isPrimary"];
	    }
	}

}

