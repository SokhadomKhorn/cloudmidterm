/**
 * ====================================================================
 * Smart Campus Access Control - Round-Robin Load Balancer Module
 * ====================================================================
 * Demonstrates functional load balancing across multiple microservice
 * instances for high-concurrency door access swipe & logging traffic.
 */

class RoundRobinLoadBalancer {
    constructor(serviceName, instances = []) {
        this.serviceName = serviceName;
        this.instances = instances.map(inst => ({
            url: typeof inst === 'string' ? inst : inst.url,
            name: typeof inst === 'object' && inst.name ? inst.name : inst,
            port: typeof inst === 'object' && inst.port ? inst.port : (new URL(typeof inst === 'string' ? inst : inst.url).port),
            requestCount: 0,
            active: true
        }));
        this.currentIndex = 0;
    }

    /**
     * Selects next available upstream target using Round-Robin algorithm
     */
    getNextTarget() {
        if (!this.instances || this.instances.length === 0) {
            throw new Error(`[Load Balancer] No upstream instances registered for ${this.serviceName}`);
        }

        const target = this.instances[this.currentIndex];
        target.requestCount++;

        // Advance index cyclically
        this.currentIndex = (this.currentIndex + 1) % this.instances.length;

        console.log(`[Load Balancer: ${this.serviceName}] Routing request #${target.requestCount} -> ${target.name} (${target.url})`);

        return target;
    }

    /**
     * Returns live stats showing load distribution across instances
     */
    getStats() {
        const totalRequests = this.instances.reduce((sum, inst) => sum + inst.requestCount, 0);
        return {
            service: this.serviceName,
            totalRequests,
            instances: this.instances.map(inst => ({
                name: inst.name,
                url: inst.url,
                port: inst.port,
                requestCount: inst.requestCount,
                loadPercentage: totalRequests > 0 ? `${((inst.requestCount / totalRequests) * 100).toFixed(1)}%` : '0%'
            }))
        };
    }
}

module.exports = RoundRobinLoadBalancer;
