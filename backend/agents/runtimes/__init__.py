from agents.runtimes.base import Runtime


def get_runtime(name: str) -> Runtime:
    match name:
        case "docker":
            from agents.runtimes.docker import DockerRuntime

            return DockerRuntime()
        case "modal":
            from agents.runtimes.modal import ModalRuntime

            return ModalRuntime()
        case _:
            raise ValueError(f"Unknown runtime: {name}")
